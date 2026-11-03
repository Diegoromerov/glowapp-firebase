// backend/src/controllers/creditController.js
//
// D-GL-023 — Compensación en créditos.
//
// El no-show del prestador se compensa con 20.000 en créditos dentro de la
// plataforma, no en efectivo (el efectivo solo aplica en una disputa
// excepcional). Los créditos:
//   · vencen a los 90 días,
//   · no se retiran ni se transfieren,
//   · se aplican hasta el 50% de una reserva,
//   · son un pasivo para GlowApp, no un ingreso.

const { pool } = require('../config/db');

const COMPENSACION_NO_SHOW = 20000;
const MAX_APLICACION = 0.5; // 50% de la reserva

/**
 * Emite un crédito y su movimiento de emisión. Debe llamarse dentro de una
 * transacción abierta por el llamador.
 */
async function emitirCredito(client, { usuarioId, origen, monto, referenciaId = null, diasVigencia = 90 }) {
  const { rows } = await client.query(
    `INSERT INTO creditos (usuario_id, origen, referencia_id, monto_inicial, saldo, vence_at)
     VALUES ($1, $2, $3, $4, $4, NOW() + ($5 || ' days')::interval)
     RETURNING *`,
    [usuarioId, origen, referenciaId, monto, diasVigencia]
  );

  const credito = rows[0];

  await client.query(
    `INSERT INTO creditos_movimientos (credito_id, usuario_id, tipo, monto)
     VALUES ($1, $2, 'EMISION', $3)`,
    [credito.id, usuarioId, monto]
  );

  return credito;
}

// POST /api/bookings/:id/no-show — el cliente reporta que el prestador no llegó
exports.reportProviderNoShow = async (req, res) => {
  const bookingId = req.params.id;
  const clientId = req.user.id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, client_id, provider_id, estado, valor_bruto, payment_status, scheduled_at
         FROM bookings WHERE id = $1 FOR UPDATE`,
      [bookingId]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Reserva no encontrada.' });
    }

    const booking = rows[0];

    if (booking.client_id !== clientId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Solo el cliente puede reportar el no-show del prestador.' });
    }

    if (!['CONFIRMADA', 'EN_PROGRESO', 'PENDIENTE_PAGO'].includes(booking.estado)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `No se puede reportar no-show en estado ${booking.estado}.` });
    }

    // Solo después de la hora de la cita, con 15 minutos de gracia.
    const minutosDesdeCita = (Date.now() - new Date(booking.scheduled_at).getTime()) / 60000;
    if (minutosDesdeCita < 15) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'El no-show se puede reportar 15 minutos después de la hora de la cita.',
        minutos_desde_cita: Math.max(0, Math.round(minutosDesdeCita))
      });
    }

    // Si el prestador ya hizo check-in, no es no-show.
    const otp = await client.query(
      `SELECT id FROM otp_validaciones WHERE booking_id = $1 AND estado = 'USADO'`,
      [bookingId]
    );
    if (otp.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'El servicio ya fue verificado con OTP; no aplica no-show.' });
    }

    const yaCompensado = await client.query(
      `SELECT id FROM creditos WHERE origen = 'NO_SHOW_PRESTADOR' AND referencia_id = $1`,
      [bookingId]
    );
    if (yaCompensado.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Este servicio ya fue compensado.' });
    }

    // 1. Devolución íntegra al cliente (el servicio no ocurrió).
    if (booking.payment_status === 'paid') {
      await client.query(
        `INSERT INTO reembolsos
           (booking_id, client_id, monto, porcentaje_devolucion, tramo, motivo, estado)
         VALUES ($1, $2, $3, 100, 'CANCELA_PRESTADOR', 'No-show del prestador', 'PENDIENTE')`,
        [bookingId, clientId, Number(booking.valor_bruto) || 0]
      );
    }

    // 2. Compensación de 20.000 en créditos.
    const credito = await emitirCredito(client, {
      usuarioId: clientId,
      origen: 'NO_SHOW_PRESTADOR',
      monto: COMPENSACION_NO_SHOW,
      referenciaId: bookingId
    });

    // 3. Se descuenta al prestador del saldo disponible; lo que no alcance queda
    //    como deuda para la siguiente dispersión (el wallet no puede ser negativo).
    const wallet = await client.query(
      `SELECT saldo_disponible FROM provider_wallet WHERE provider_id = $1 FOR UPDATE`,
      [booking.provider_id]
    );
    const disponible = parseFloat(wallet.rows[0]?.saldo_disponible || 0);
    const debitado = Math.min(disponible, COMPENSACION_NO_SHOW);
    const deuda = COMPENSACION_NO_SHOW - debitado;

    if (debitado > 0) {
      await client.query(
        `UPDATE provider_wallet
            SET saldo_disponible = GREATEST(0, saldo_disponible - $2), updated_at = NOW()
          WHERE provider_id = $1`,
        [booking.provider_id, debitado]
      );

      await client.query(
        `INSERT INTO wallet_transactions
           (provider_id, booking_id, tipo, monto, saldo_resultante, estado, descripcion, metadata)
         SELECT $1, $2, 'AJUSTE_ADMIN', $3, saldo_disponible + saldo_pendiente, 'COMPLETADO',
                'Compensación al cliente por no-show', CAST($4 AS jsonb)
         FROM provider_wallet WHERE provider_id = $1`,
        [booking.provider_id, bookingId, debitado, JSON.stringify({ deuda_pendiente: deuda })]
      );
    }

    await client.query(
      `UPDATE bookings
          SET estado = 'CANCELADA', cancelado_por = 'NO_SHOW_PRESTADOR', cancelado_at = NOW()
        WHERE id = $1`,
      [bookingId]
    );

    await client.query('COMMIT');

    res.status(201).json({
      ok: true,
      credito: { id: credito.id, monto: COMPENSACION_NO_SHOW, vence_at: credito.vence_at },
      reembolso: booking.payment_status === 'paid' ? Number(booking.valor_bruto) : 0,
      descuento_prestador: debitado,
      deuda_pendiente: deuda,
      mensaje: 'Se devuelve el pago y se acreditan 20.000 en créditos por el no-show.'
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al reportar no-show:', err);
    res.status(500).json({ error: 'Error al registrar el no-show.' });
  } finally {
    client.release();
  }
};

// GET /api/credits/me — saldo de créditos vigentes
exports.getMyCredits = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, origen, monto_inicial, saldo, vence_at, creado_at,
              (vence_at <= NOW()) AS vencido
         FROM creditos
        WHERE usuario_id = $1
        ORDER BY creado_at DESC`,
      [req.user.id]
    );

    const vigentes = rows.filter((c) => !c.vencido && Number(c.saldo) > 0);
    const total = vigentes.reduce((acc, c) => acc + Number(c.saldo), 0);

    res.json({ creditos: rows, vigentes: vigentes.length, saldo_total: total });
  } catch (err) {
    console.error('Error al consultar créditos:', err);
    res.status(500).json({ error: 'Error al consultar los créditos.' });
  }
};

// POST /api/credits/apply — aplicar créditos a una reserva (hasta 50%)
exports.applyCredit = async (req, res) => {
  const { booking_id, monto } = req.body;
  const montoSolicitado = Math.round(Number(monto));

  if (!booking_id || !Number.isFinite(montoSolicitado) || montoSolicitado <= 0) {
    return res.status(400).json({ error: 'Se requieren booking_id y monto.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const bookingRes = await client.query(
      `SELECT id, client_id, valor_bruto, estado FROM bookings WHERE id = $1 FOR UPDATE`,
      [booking_id]
    );
    if (!bookingRes.rows.length || bookingRes.rows[0].client_id !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Reserva no encontrada.' });
    }

    const booking = bookingRes.rows[0];
    const maxAplicable = Math.round(Number(booking.valor_bruto) * MAX_APLICACION);

    if (montoSolicitado > maxAplicable) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Solo puedes cubrir hasta el 50% de la reserva ($${maxAplicable.toLocaleString('es-CO')}).`,
        maximo: maxAplicable
      });
    }

    const creditos = await client.query(
      `SELECT id, saldo FROM creditos
        WHERE usuario_id = $1 AND saldo > 0 AND vence_at > NOW()
        ORDER BY vence_at ASC
        FOR UPDATE`,
      [req.user.id]
    );

    let restante = montoSolicitado;
    const usados = [];

    for (const c of creditos.rows) {
      if (restante <= 0) break;
      const usar = Math.min(Number(c.saldo), restante);

      await client.query(`UPDATE creditos SET saldo = saldo - $2 WHERE id = $1`, [c.id, usar]);
      await client.query(
        `INSERT INTO creditos_movimientos (credito_id, usuario_id, tipo, monto, booking_id)
         VALUES ($1, $2, 'USO', $3, $4)`,
        [c.id, req.user.id, usar, booking_id]
      );

      usados.push({ credito_id: c.id, monto: usar });
      restante -= usar;
    }

    if (restante > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Saldo de créditos insuficiente.',
        faltante: restante
      });
    }

    await client.query(
      `UPDATE bookings SET credito_aplicado = COALESCE(credito_aplicado, 0) + $2 WHERE id = $1`,
      [booking_id, montoSolicitado]
    );

    await client.query('COMMIT');

    res.json({
      ok: true,
      aplicado: montoSolicitado,
      creditos: usados,
      mensaje: `Se aplicaron $${montoSolicitado.toLocaleString('es-CO')} en créditos a la reserva.`
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al aplicar créditos:', err);
    res.status(500).json({ error: 'Error al aplicar los créditos.' });
  } finally {
    client.release();
  }
};

// Se agregan al objeto exports existente: reasignar module.exports aquí
// borraría los handlers de arriba.
exports.emitirCredito = emitirCredito;
exports.COMPENSACION_NO_SHOW = COMPENSACION_NO_SHOW;

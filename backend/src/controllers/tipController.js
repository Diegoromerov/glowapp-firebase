// backend/src/controllers/tipController.js
//
// D-GL-023 — Propina: 100% al prestador, 0% de comisión.
//
// Reglas que implementa:
//   · La propina se deja DESPUÉS del servicio (no en el checkout: compite con la
//     conversión y el cliente todavía no sabe cómo le fue).
//   · No paga comisión ni retención: se acredita íntegra al prestador.
//   · Va en la misma dispersión, así que soporta el porcentaje de Wompi; ese
//     costo lo absorbe GlowApp, no el prestador.
//   · Una sola propina por servicio (restricción UNIQUE en la tabla).
//
// La pasarela de cobro no está integrada en el repositorio (wompiService solo
// dispersa). En desarrollo se acredita con el simulador; en producción la
// propina queda PENDIENTE con su referencia hasta que exista el cobro real.

const { pool } = require('../config/db');
const crypto = require('crypto');

const simuladorPermitido = () =>
  process.env.NODE_ENV !== 'production' || process.env.ALLOW_PAYMENT_SIMULATOR === 'true';

const referenciaPropina = (bookingId) =>
  'TIP_' + crypto.createHash('sha256').update(String(bookingId)).digest('hex').slice(0, 16).toUpperCase();

// Mínimo 1.000 COP (convención de unidades) y máximo 50% del servicio: una
// propina del 100% del valor casi siempre es un error de dedo.
const MIN_PROPINA = 1000;

async function acreditarPropina(client, { propinaId, bookingId, providerId, monto }) {
  await client.query(
    `INSERT INTO provider_wallet (provider_id, saldo_disponible, total_ganado)
     VALUES ($1, $2, $2)
     ON CONFLICT (provider_id) DO UPDATE
       SET saldo_disponible = provider_wallet.saldo_disponible + $2,
           total_ganado     = provider_wallet.total_ganado + $2,
           updated_at       = NOW()`,
    [providerId, monto]
  );

  await client.query(
    `INSERT INTO wallet_transactions
       (provider_id, booking_id, tipo, monto, saldo_resultante, estado, descripcion, metadata)
     SELECT $1, $2, 'PROPINA', $3, saldo_disponible + saldo_pendiente, 'COMPLETADO',
            'Propina del cliente (100% para ti, sin comisión)', CAST($4 AS jsonb)
     FROM provider_wallet WHERE provider_id = $1`,
    [providerId, bookingId, monto, JSON.stringify({ propina_id: propinaId })]
  );

  await client.query(
    `UPDATE propinas SET estado = 'PAGADA', pagado_at = NOW() WHERE id = $1`,
    [propinaId]
  );

  await client.query(
    `UPDATE bookings SET propina = COALESCE(propina, 0) + $2 WHERE id = $1`,
    [bookingId, monto]
  );
}

// POST /api/bookings/:id/tip   { monto }
exports.createTip = async (req, res) => {
  const bookingId = req.params.id;
  const clientId = req.user.id;
  const monto = Math.round(Number(req.body?.monto));

  if (!Number.isFinite(monto) || monto < MIN_PROPINA) {
    return res.status(400).json({
      error: `La propina mínima es $${MIN_PROPINA.toLocaleString('es-CO')} COP.`,
      minimo: MIN_PROPINA
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, client_id, provider_id, estado, valor_bruto, completed_at, scheduled_at
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
      return res.status(403).json({ error: 'Solo el cliente del servicio puede dejar propina.' });
    }

    if (booking.estado !== 'COMPLETADA') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'La propina se deja cuando el servicio está completado.' });
    }

    const fin = booking.completed_at ? new Date(booking.completed_at) : new Date(booking.scheduled_at);
    const dias = (Date.now() - fin.getTime()) / (1000 * 60 * 60 * 24);
    if (dias > 7) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'La ventana para dejar propina es de 7 días.' });
    }

    const maximo = Math.round(Number(booking.valor_bruto) * 0.5);
    if (monto > maximo) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `La propina no puede superar el 50% del servicio ($${maximo.toLocaleString('es-CO')}).`,
        maximo
      });
    }

    const existente = await client.query(
      'SELECT id, estado FROM propinas WHERE booking_id = $1',
      [bookingId]
    );
    if (existente.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Ya dejaste propina para este servicio.' });
    }

    const referencia = referenciaPropina(bookingId);
    const insert = await client.query(
      `INSERT INTO propinas (booking_id, client_id, provider_id, monto, estado, referencia_wompi)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [bookingId, clientId, booking.provider_id, monto, simuladorPermitido() ? 'PAGADA' : 'PENDIENTE', referencia]
    );

    const propina = insert.rows[0];

    if (simuladorPermitido()) {
      await acreditarPropina(client, {
        propinaId: propina.id,
        bookingId,
        providerId: booking.provider_id,
        monto
      });
    }

    await client.query('COMMIT');

    return res.status(201).json({
      ok: true,
      propina: {
        id: propina.id,
        monto,
        estado: propina.estado,
        referencia
      },
      comision: 0,
      mensaje: simuladorPermitido()
        ? `Propina de $${monto.toLocaleString('es-CO')} acreditada al prestador (sin comisión).`
        : 'Propina registrada. Se acredita al confirmarse el pago.'
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ya dejaste propina para este servicio.' });
    }
    console.error('Error al registrar propina:', err);
    return res.status(500).json({ error: 'Error al registrar la propina.' });
  } finally {
    client.release();
  }
};

// GET /api/bookings/:id/tip  — estado de la propina de una reserva
exports.getTip = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.monto, p.estado, p.pagado_at, p.creado_at
         FROM propinas p
         JOIN bookings b ON b.id = p.booking_id
        WHERE p.booking_id = $1 AND (b.client_id = $2 OR b.provider_id = $2)`,
      [req.params.id, req.user.id]
    );

    if (!rows.length) return res.json({ propina: null });
    res.json({ propina: rows[0] });
  } catch (err) {
    console.error('Error al consultar propina:', err);
    res.status(500).json({ error: 'Error al consultar la propina.' });
  }
};

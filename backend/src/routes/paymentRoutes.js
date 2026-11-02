const { wrapRouterAsync } = require('../utils/expressAsync');
// backend/src/routes/paymentRoutes.js
// Sistema completo de pagos: OTP, Wallet, Retiros, Disputas

const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const { paymentLimiter, otpLimiter } = require('../middleware/rateLimiter');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const wompiService = require('../services/wompiService');
const wompiClient = require('../services/wompiClient');
const wompiPayoutsClient = require('../services/wompiPayoutsClient');
const { aCentavos, aDecimal, sumarMontos } = require('../utils/money');

// ─── UTILIDADES ──────────────────────────────────────────────────────────────

async function getConfig(key, defaultValue = null) {
  const { rows } = await pool.query(
    'SELECT value FROM platform_config WHERE key = $1',
    [key]
  );
  return rows.length > 0 ? rows[0].value : defaultValue;
}

async function generarOTP() {
  const codigo = String(Math.floor(100000 + Math.random() * 900000));
  const hash = await bcrypt.hash(codigo, 10);
  return { codigo, hash };
}

async function auditLog(client, { actorId, accion, tabla, registroId, datosAntes, datosDespues, ip }) {
  await client.query(
    `INSERT INTO audit_log (actor_id, accion, tabla, registro_id, datos_antes, datos_despues, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [actorId, accion, tabla, registroId, datosAntes ? JSON.stringify(datosAntes) : null,
     datosDespues ? JSON.stringify(datosDespues) : null, ip || null]
  );
}

async function requirePrestador(req, res) {
  const { rows } = await pool.query('SELECT rol FROM usuarios WHERE id = $1', [req.user.id]);
  if (!rows.length || rows[0].rol !== 'PRESTADOR') {
    res.status(403).json({ error: 'Solo prestadores pueden realizar esta acción.' });
    return false;
  }
  return true;
}

// CI-48: la compuerta depende del ROL de la base, nunca del email.
// Antes aceptaba además los emails 'admin@beautyapp.com' y 'admin', lo que dejaba
// entrar a cualquier cuenta con ese email aunque su rol fuese PRESTADOR o CLIENTE.
async function requireAdmin(req, res) {
  const { rows } = await pool.query('SELECT rol FROM usuarios WHERE id = $1', [req.user.id]);
  if (!rows.length || rows[0].rol !== 'ADMIN') {
    res.status(403).json({ error: 'Solo administradores pueden realizar esta acción.' });
    return false;
  }
  return true;
}

// ─── CHECK-IN GPS ────────────────────────────────────────────────────────────

/**
 * Distancia en metros entre dos coordenadas (haversine).
 * Devuelve null si falta cualquiera de los dos puntos: sin referencia no se
 * puede validar, y fingir que se validó es peor que no validar.
 */
function distanciaMetros(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => !Number.isFinite(v))) return null;
  const R = 6371000;
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ─── Aceite de términos de Wompi (Habeas Data) ───────────────────────────────
// ─── Aceite de términos de Wompi (Habeas Data) ───────────────────────────────
/**
 * `GET /api/payments/wompi/acceptance-token`
 *
 * El token de aceptación es obligatorio al crear una transacción en Wompi y es
 * la evidencia del Habeas Data. La app NO puede fabricarlo ni conocer la llave
 * pública del comercio, así que lo pide aquí, muestra el `permalink` de
 * términos y lo devuelve en `POST /bookings/:id/pay`.
 *
 * Sin la llave pública configurada se responde 503 (cerrado en falso), nunca un
 * token inventado: un token falso solo movería el fallo a Wompi.
 */
router.get(
  '/payments/wompi/acceptance-token',
  authMiddleware,
  paymentLimiter,
  wrapRouterAsync(async (req, res) => {
    if (!wompiClient.isConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'PAYMENT_GATEWAY_NOT_CONFIGURED',
        message: 'La pasarela de pagos no está configurada en este entorno.'
      });
    }

    try {
      const { acceptanceToken, personalDataAuthToken, permalink } =
        await wompiClient.getAcceptanceTokens();

      return res.json({
        success: true,
        acceptance_token: acceptanceToken,
        personal_data_auth_token: personalDataAuthToken,
        permalink
      });
    } catch (err) {
      console.error(
        '⚠️  No se pudo obtener el token de aceptación de Wompi:',
        err && err.message ? err.message : err
      );
      return res.status(502).json({
        success: false,
        error: 'PAYMENT_GATEWAY_UNAVAILABLE',
        message: 'No se pudo obtener el token de aceptación de Wompi.'
      });
    }
  })
);

// GET /api/payments/wompi/public-key
// Entrega la llave pública del comercio (pub_test_* / pub_prod_*) para
// tokenización de tarjeta en el cliente (POST /tokens/cards).
// La llave pública está diseñada para vivir en el cliente (no es secreto).
router.get(
  '/payments/wompi/public-key',
  authMiddleware,
  paymentLimiter,
  wrapRouterAsync(async (req, res) => {
    if (!wompiClient.isConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'PAYMENT_GATEWAY_NOT_CONFIGURED',
        message: 'La pasarela de pagos no está configurada en este entorno.'
      });
    }

    const publicKey = wompiClient.publicKey;
    if (!publicKey) {
      return res.status(503).json({
        success: false,
        error: 'WOMPI_PUBLIC_KEY_MISSING',
        message: 'La llave pública de Wompi no está configurada.'
      });
    }

    return res.json({
      success: true,
      public_key: publicKey
    });
  })
);


router.post('/bookings/:id/checkin', authMiddleware, async (req, res) => {
  if (!await requirePrestador(req, res)) return;

  const { id } = req.params;
  const { latitud, longitud } = req.body;

  if (!latitud || !longitud) {
    return res.status(400).json({ error: 'Se requieren coordenadas GPS para el check-in.' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT b.*, u.nombre as cliente_nombre
       FROM bookings b
       JOIN usuarios u ON b.client_id = u.id
       WHERE b.id = $1 AND b.provider_id = $2 AND b.estado = 'CONFIRMADA'`,
      [id, req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Reserva no encontrada o no disponible para check-in.' });
    }

    const tolerancia = parseInt(await getConfig('gps_tolerancia_metros', '500'));
    const booking = rows[0];

    // La tolerancia se leía y nunca se validaba: el check-in era decorativo.
    // Si la reserva tiene coordenadas de referencia, se exige estar dentro del
    // radio. Si no las tiene, se registra el punto y se marca como no validado
    // (la dirección estructurada no se puede geocodificar aquí).
    const distancia = distanciaMetros(
      Number(latitud), Number(longitud),
      booking.service_lat != null ? Number(booking.service_lat) : null,
      booking.service_lng != null ? Number(booking.service_lng) : null
    );

    if (distancia !== null && distancia > tolerancia) {
      return res.status(409).json({
        error: `Estás a ${Math.round(distancia)} m del punto del servicio. El máximo permitido es ${tolerancia} m.`,
        distancia_metros: Math.round(distancia),
        tolerancia_metros: tolerancia
      });
    }

    await pool.query(
      `UPDATE bookings SET estado = 'CHECKIN_REALIZADO',
       checkin_lat = $3, checkin_lng = $4, checkin_at = NOW(),
       notes = COALESCE(notes, '') || $5
       WHERE id = $1 AND provider_id = $2`,
      [
        id, req.user.id, Number(latitud), Number(longitud),
        ` [CHECKIN: ${latitud},${longitud}${distancia !== null ? ` @ ${Math.round(distancia)}m` : ' (sin referencia)'} @ ${new Date().toISOString()}]`
      ]
    );

    res.json({
      ok: true,
      mensaje: 'Check-in registrado. Puedes comenzar el servicio.',
      tolerancia_metros: tolerancia,
      distancia_metros: distancia !== null ? Math.round(distancia) : null,
      gps_validado: distancia !== null
    });
  } catch (err) {
    console.error('Error en check-in:', err);
    res.status(500).json({ error: 'Error al registrar check-in.' });
  }
});

// ─── COMPLETAR SERVICIO → GENERAR OTP ────────────────────────────────────────

router.post('/bookings/:id/complete', authMiddleware, async (req, res) => {
  if (!await requirePrestador(req, res)) return;

  const { id } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT b.*, u.email as cliente_email, u.nombre as cliente_nombre
       FROM bookings b
       JOIN usuarios u ON b.client_id = u.id
       WHERE b.id = $1 AND b.provider_id = $2
         AND b.estado IN ('CONFIRMADA', 'CHECKIN_REALIZADO', 'EN_PROGRESO')`,
      [id, req.user.id]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Reserva no encontrada o en estado incorrecto.' });
    }

    const booking = rows[0];

    const otpExistente = await client.query(
      `SELECT id FROM otp_validaciones
       WHERE booking_id = $1 AND estado = 'ACTIVO' AND expira_at > NOW()`,
      [id]
    );
    if (otpExistente.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Ya existe un OTP activo para esta reserva.' });
    }

    const vigenciaMin = parseInt(await getConfig('otp_vigencia_minutos', '45'));
    const { codigo, hash } = await generarOTP();
    const expiraAt = new Date(Date.now() + vigenciaMin * 60 * 1000);

    await client.query(
      `INSERT INTO otp_validaciones (booking_id, codigo_hash, expira_at, ip_generacion)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (booking_id) DO UPDATE
         SET codigo_hash = $2, expira_at = $3, estado = 'ACTIVO',
             intentos_fallidos = 0, usado_at = NULL`,
      [id, hash, expiraAt, req.ip]
    );

    await client.query(
      `UPDATE bookings SET estado = 'ESPERANDO_OTP' WHERE id = $1`,
      [id]
    );

    await client.query('COMMIT');

    // El código OTP no se registra en logs (A360-2026-09-22/C-06) ni se devuelve al cliente
    // salvo opt-in explícito de desarrollo: antes bastaba con que NODE_ENV no fuera exactamente 'production'.

    res.json({
      ok: true,
      mensaje: 'Servicio marcado como completado. Se envió el código al cliente.',
      otp_expira_at: expiraAt,
      otp_vigencia_minutos: vigenciaMin,
      ...(process.env.NODE_ENV !== 'production' && process.env.EXPOSE_DEV_OTP === 'true' && { otp_dev: codigo })
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al completar servicio:', err);
    res.status(500).json({ error: 'Error al procesar la finalización del servicio.' });
  } finally {
    client.release();
  }
});

// ─── CONFIRMAR OTP → DISPERSIÓN ──────────────────────────────────────────────

router.post('/bookings/:id/confirm-otp', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { codigo } = req.body;

  if (!codigo || !/^\d{6}$/.test(codigo)) {
    return res.status(400).json({ error: 'El código debe ser de 6 dígitos numéricos.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const otpResult = await client.query(
      `SELECT ov.*, b.valor_bruto, b.comision_plataforma, b.pago_neto_prestador,
              b.provider_id, b.client_id
       FROM otp_validaciones ov
       JOIN bookings b ON ov.booking_id = b.id
       WHERE ov.booking_id = $1 AND ov.estado = 'ACTIVO'`,
      [id]
    );

    if (!otpResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No hay un código activo para esta reserva.' });
    }

    const otp = otpResult.rows[0];

    if (String(otp.client_id) !== String(req.user.id)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Solo el cliente de la reserva puede confirmar el OTP.' });
    }

    if (new Date() > new Date(otp.expira_at)) {
      await client.query(
        `UPDATE otp_validaciones SET estado = 'EXPIRADO' WHERE booking_id = $1`,
        [id]
      );
      await client.query('ROLLBACK');
      return res.status(410).json({
        error: 'El código ha expirado.',
        accion: 'ABRIR_DISPUTA',
        mensaje: 'El prestador puede reenviar el código o puedes abrir una disputa.'
      });
    }

    const maxIntentos = parseInt(await getConfig('otp_max_intentos', '3'));
    if (otp.intentos_fallidos >= maxIntentos) {
      await client.query('ROLLBACK');
      return res.status(429).json({
        error: 'Código bloqueado por demasiados intentos fallidos.',
        accion: 'DISPUTA_AUTOMATICA'
      });
    }

    const esValido = await bcrypt.compare(codigo, otp.codigo_hash);
    if (!esValido) {
      const nuevosIntentos = otp.intentos_fallidos + 1;
      const nuevoEstado = nuevosIntentos >= maxIntentos ? 'BLOQUEADO' : 'ACTIVO';

      await client.query(
        `UPDATE otp_validaciones
         SET intentos_fallidos = $2, estado = $3
         WHERE booking_id = $1`,
        [id, nuevosIntentos, nuevoEstado]
      );
      await client.query('COMMIT');

      const intentosRestantes = maxIntentos - nuevosIntentos;
      if (nuevoEstado === 'BLOQUEADO') {
        return res.status(429).json({
          error: 'Código incorrecto. OTP bloqueado.',
          intentos_restantes: 0,
          accion: 'DISPUTA_AUTOMATICA'
        });
      }
      return res.status(400).json({
        error: `Código incorrecto. ${intentosRestantes} intento(s) restante(s).`,
        intentos_restantes: intentosRestantes
      });
    }

    const ventanaHoras = parseInt(await getConfig('wallet_ventana_pendiente_horas', '48'));
    const maduraAt = new Date(Date.now() + ventanaHoras * 60 * 60 * 1000);

    // D-GL-023 — SIN RETENCIONES.
    // El prestador recibe íntegro su pago neto (80% del valor del servicio).
    // Retefuente, reteICA y reteIVA se eliminaron: la plataforma no retiene
    // tributos de un tercero independiente, y la reteIVA se aplicaba sobre toda
    // la comisión en vez de sobre el IVA contenido en ella (6,3× de más).
    // El cálculo se conserva en centavos enteros para que la dispersión no derive.
    const basePagoNetoCentavos = aCentavos(otp.pago_neto_prestador);
    const comisionPlataformaCentavos = aCentavos(otp.comision_plataforma);

    const basePagoNeto = aDecimal(basePagoNetoCentavos);
    const comisionPlataforma = aDecimal(comisionPlataformaCentavos);
    const retencionFuente = 0;
    const retencionIca = 0;
    const retencionIva = 0;
    const totalRetenciones = 0;
    const montoNeto = basePagoNeto;

    await client.query(
      `UPDATE otp_validaciones SET estado = 'USADO', usado_at = NOW() WHERE booking_id = $1`,
      [id]
    );

    await client.query(
      `UPDATE bookings SET estado = 'COMPLETADA', payment_status = 'paid', completed_at = NOW() WHERE id = $1`,
      [id]
    );

    const walletResult = await client.query(
      `INSERT INTO provider_wallet (provider_id, saldo_pendiente, total_ganado)
       VALUES ($1, $2, $2)
       ON CONFLICT (provider_id) DO UPDATE
         SET saldo_pendiente = provider_wallet.saldo_pendiente + $2,
             total_ganado    = provider_wallet.total_ganado + $2,
             updated_at      = NOW()
       RETURNING *`,
      [otp.provider_id, montoNeto]
    );
    const wallet = walletResult.rows[0];

    await client.query(
      `INSERT INTO wallet_transactions
         (provider_id, booking_id, tipo, monto, saldo_resultante, estado, descripcion, metadata)
       VALUES ($1, $2, 'CREDITO_SERVICIO', $3, $4, 'PENDIENTE', $5, $6)`,
      [
        otp.provider_id, id, montoNeto,
        sumarMontos(wallet.saldo_disponible, wallet.saldo_pendiente),
        `Servicio completado. Disponible en ${ventanaHoras}h.`,
        JSON.stringify({
          madura_at: maduraAt,
          comision_plataforma: otp.comision_plataforma,
          retencion_fuente: retencionFuente,
          retencion_ica: retencionIca,
          retencion_iva: retencionIva,
          base_pago_neto: basePagoNeto,
          total_retenciones: totalRetenciones
        })
      ]
    );

    // ─── LIBERAR COMISIÓN DE GLOWSTORE SI APLICA ───
    const storeOrderRes = await client.query(
      'SELECT id, comision_total_prestador FROM pedidos_tienda WHERE booking_id = $1 AND prestador_comisionado_id = $2;',
      [id, otp.provider_id]
    );

    if (storeOrderRes.rows.length > 0) {
      const storeOrder = storeOrderRes.rows[0];
      const comisionTiendaCentavos = aCentavos(storeOrder.comision_total_prestador);
      const comisionTienda = aDecimal(comisionTiendaCentavos);

      if (comisionTienda > 0) {
        // Actualizar wallet sumando la comisión de la tienda al saldo pendiente
        const walletTiendaResult = await client.query(
          `UPDATE provider_wallet 
           SET saldo_pendiente = saldo_pendiente + $2,
               total_ganado    = total_ganado + $2,
               updated_at      = NOW()
           WHERE provider_id = $1
           RETURNING *`,
          [otp.provider_id, comisionTienda]
        );
        const walletTienda = walletTiendaResult.rows[0];

        // Insertar transacción de tipo CREDITO_PRODUCTO
        await client.query(
          `INSERT INTO wallet_transactions
             (provider_id, booking_id, tipo, monto, saldo_resultante, estado, descripcion, metadata)
           VALUES ($1, $2, 'CREDITO_PRODUCTO', $3, $4, 'PENDIENTE', $5, $6)`,
          [
            otp.provider_id, 
            id, 
            comisionTienda,
            sumarMontos(walletTienda.saldo_disponible, walletTienda.saldo_pendiente),
            `Comisión de productos en GlowStore - Pedido #${storeOrder.id}`,
            JSON.stringify({
              madura_at: maduraAt.toISOString(),
              pedido_id: storeOrder.id,
              comision_total: comisionTienda
            })
          ]
        );
        console.log(`💰 Acreditada comisión de tienda de $${comisionTienda} para el prestador ${otp.provider_id}`);
      }
    }

    await auditLog(client, {
      actorId: req.user.id,
      accion: 'OTP_CONFIRMADO',
      tabla: 'bookings',
      registroId: id,
      datosDespues: { monto_neto: montoNeto, madura_at: maduraAt },
      ip: req.ip
    });

    await client.query('COMMIT');

    res.json({
      ok: true,
      mensaje: '¡Servicio confirmado! El pago estará disponible para el prestador en breve.',
      monto_neto_prestador: montoNeto,
      disponible_en: maduraAt,
      ventana_horas: ventanaHoras
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al confirmar OTP:', err);
    res.status(500).json({ error: 'Error al procesar la confirmación.' });
  } finally {
    client.release();
  }
});

// ─── WALLET — SALDO Y RESUMEN ─────────────────────────────────────────────────

router.get('/wallet', authMiddleware, async (req, res) => {
  if (!await requirePrestador(req, res)) return;

  try {
    // Ledger append-only: la maduración NO muta el asiento; se deriva de
    // metadata.madura_at y se registra la acreditación como evento.
    const madurados = await pool.query(
      `SELECT COALESCE(SUM(wt.monto), 0) as total
       FROM wallet_transactions wt
       WHERE wt.tipo IN ('CREDITO_SERVICIO', 'CREDITO_PRODUCTO')
         AND wt.estado <> 'REVERTIDO'
         AND wt.provider_id = $1
         AND (wt.metadata->>'madura_at')::timestamptz <= NOW()
         AND NOT EXISTS (
           SELECT 1 FROM wallet_ledger_events e
           WHERE e.tx_id = wt.id AND e.evento = 'ACREDITADO'
         )`,
      [req.user.id]
    );

    if (parseFloat(madurados.rows[0].total) > 0) {
      await pool.query(
        `UPDATE provider_wallet
         SET saldo_disponible = saldo_disponible + $2,
             saldo_pendiente  = GREATEST(0, saldo_pendiente - $2),
             updated_at       = NOW()
         WHERE provider_id = $1`,
        [req.user.id, parseFloat(madurados.rows[0].total)]
      );
      await pool.query(
        `INSERT INTO wallet_ledger_events (tx_id, provider_id, evento, detalle)
         SELECT wt.id, wt.provider_id, 'ACREDITADO',
                jsonb_build_object('monto', wt.monto, 'origen', 'wallet-consulta')
         FROM wallet_transactions wt
         WHERE wt.tipo IN ('CREDITO_SERVICIO', 'CREDITO_PRODUCTO')
           AND wt.estado <> 'REVERTIDO'
           AND wt.provider_id = $1
           AND (wt.metadata->>'madura_at')::timestamptz <= NOW()
           AND NOT EXISTS (
             SELECT 1 FROM wallet_ledger_events e
             WHERE e.tx_id = wt.id AND e.evento = 'ACREDITADO'
           )`,
        [req.user.id]
      );
    }

    const { rows } = await pool.query(
      `SELECT pw.*,
              (SELECT COUNT(*) FROM disputas d
               JOIN bookings b ON d.booking_id = b.id
               WHERE b.provider_id = $1 AND d.estado IN ('ABIERTA','EN_REVISION')) as disputas_activas
       FROM provider_wallet pw
       WHERE pw.provider_id = $1`,
      [req.user.id]
    );

    if (!rows.length) {
      await pool.query(
        'INSERT INTO provider_wallet (provider_id) VALUES ($1) ON CONFLICT DO NOTHING',
        [req.user.id]
      );
      return res.json({
        saldo_disponible: 0, saldo_pendiente: 0, saldo_en_disputa: 0,
        total_ganado: 0, total_retirado: 0, modelo_retiro: 'DEMANDA',
        ultimo_retiro_at: null, cuenta_verificada: false, retiros_pausados: false
      });
    }

    const wallet = rows[0];

    // D-GL-024 — el ciclo estándar es semanal y no tiene mínimo; el anticipado
    // exige 100.000 y solo opera sobre saldo madurado. El mínimo ya no bloquea
    // el retiro del ciclo: bloquea únicamente el adelanto.
    const minCop = parseInt(await getConfig('retiro_demanda_min_cop', '100000'));
    const diasMin = parseInt(await getConfig('retiro_demanda_dias', '7'));
    const saldoDisponible = parseFloat(wallet.saldo_disponible || 0);
    const saldoPendiente = parseFloat(wallet.saldo_pendiente || 0);

    let puede_retirar = false;
    let razon_bloqueo = null;
    let proxima_fecha_retiro = null;

    // El anticipado depende solo del monto maduro disponible.
    const puede_retirar_anticipado = saldoDisponible >= minCop;

    if (wallet.retiros_pausados) {
      razon_bloqueo = 'Tu cuenta tiene retiros pausados. Contacta soporte.';
    } else if (saldoDisponible <= 0) {
      razon_bloqueo = saldoPendiente > 0
        ? 'Tu saldo está en custodia. Se habilita 48 h después de cada servicio.'
        : 'Aún no tienes saldo disponible.';
    } else if (wallet.ultimo_retiro_at) {
      const diasTranscurridos = (Date.now() - new Date(wallet.ultimo_retiro_at)) / (1000 * 60 * 60 * 24);
      if (diasTranscurridos < diasMin) {
        const diasRestantes = Math.ceil(diasMin - diasTranscurridos);
        proxima_fecha_retiro = new Date(new Date(wallet.ultimo_retiro_at).getTime() + diasMin * 24 * 60 * 60 * 1000);
        razon_bloqueo = `Tu próximo retiro del ciclo es en ${diasRestantes} día(s).`
          + (puede_retirar_anticipado ? ` Puedes adelantarlo hoy desde $${minCop.toLocaleString('es-CO')}.` : '');
      } else {
        puede_retirar = true;
      }
    } else {
      puede_retirar = true;
    }

    res.json({
      ...wallet,
      puede_retirar,
      puede_retirar_anticipado,
      razon_bloqueo,
      proxima_fecha_retiro,
      minimo_retiro_cop: minCop,
      ciclo_dias: diasMin,
      saldo_total: saldoDisponible + saldoPendiente
    });
  } catch (err) {
    console.error('Error al obtener wallet:', err);
    res.status(500).json({ error: 'Error al obtener información del wallet.', details: err.message });
  }
});

// ─── WALLET — HISTORIAL DE TRANSACCIONES ─────────────────────────────────────

router.get('/wallet/transactions', authMiddleware, async (req, res) => {
  if (!await requirePrestador(req, res)) return;

  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const offset = (page - 1) * limit;

  try {
    const { rows } = await pool.query(
      `SELECT wt.*, b.valor_bruto, s.name as servicio_nombre,
              u.nombre as cliente_nombre
       FROM wallet_transactions wt
       LEFT JOIN bookings b ON wt.booking_id = b.id
       LEFT JOIN services s ON b.service_id = s.id
       LEFT JOIN usuarios u ON b.client_id = u.id
       WHERE wt.provider_id = $1
       ORDER BY wt.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );

    const { rows: total } = await pool.query(
      'SELECT COUNT(*) FROM wallet_transactions WHERE provider_id = $1',
      [req.user.id]
    );

    res.json({
      transacciones: rows,
      pagination: { page, limit, total: parseInt(total[0].count) }
    });
  } catch (err) {
    console.error('Error al obtener transacciones:', err);
    res.status(500).json({ error: 'Error al obtener historial.', details: err.message });
  }
});

// ─── WALLET — ESTADO DE CUENTA DEL PRESTADOR (D-GL-023) ─────────────────────
// El prestador reconstruye su 80% sin calculadora: valor de sus servicios,
// comisión restada, propinas como línea aparte y retenciones en cero.
// Query: ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD (por defecto, últimos 30 días)

router.get('/wallet/statement', authMiddleware, async (req, res) => {
  if (!await requirePrestador(req, res)) return;

  try {
    const hasta = req.query.hasta ? new Date(`${req.query.hasta}T23:59:59`) : new Date();
    const desde = req.query.desde
      ? new Date(`${req.query.desde}T00:00:00`)
      : new Date(hasta.getTime() - 30 * 24 * 60 * 60 * 1000);

    if (isNaN(desde.getTime()) || isNaN(hasta.getTime())) {
      return res.status(400).json({ error: 'Fechas inválidas. Usa YYYY-MM-DD.' });
    }

    const resumen = await pool.query(
      `SELECT COUNT(*)::int                          AS servicios,
              COALESCE(SUM(valor_bruto), 0)          AS valor_servicios,
              COALESCE(SUM(comision_plataforma), 0)  AS comision,
              COALESCE(SUM(propina), 0)              AS propinas,
              COALESCE(SUM(pago_neto_prestador), 0)  AS neto_servicios
         FROM bookings
        WHERE provider_id = $1
          AND estado = 'COMPLETADA'
          AND COALESCE(completed_at, scheduled_at) >= $2
          AND COALESCE(completed_at, scheduled_at) <= $3`,
      [req.user.id, desde, hasta]
    );

    const detalle = await pool.query(
      `SELECT b.id, b.scheduled_at, b.completed_at, b.valor_bruto,
              b.comision_plataforma, b.pago_neto_prestador, b.propina,
              s.name AS servicio
         FROM bookings b
         LEFT JOIN services s ON s.id = b.service_id
        WHERE b.provider_id = $1
          AND b.estado = 'COMPLETADA'
          AND COALESCE(b.completed_at, b.scheduled_at) >= $2
          AND COALESCE(b.completed_at, b.scheduled_at) <= $3
        ORDER BY COALESCE(b.completed_at, b.scheduled_at) DESC
        LIMIT 100`,
      [req.user.id, desde, hasta]
    );

    const saldos = await pool.query(
      `SELECT saldo_disponible, saldo_pendiente, saldo_en_disputa,
              total_ganado, total_retirado, modelo_retiro, ultimo_retiro_at
         FROM provider_wallet WHERE provider_id = $1`,
      [req.user.id]
    );

    const r = resumen.rows[0] || {};
    const s = saldos.rows[0] || {};

    res.json({
      periodo: { desde, hasta },
      resumen: {
        servicios: r.servicios || 0,
        valor_servicios: Number(r.valor_servicios || 0),
        comision: Number(r.comision || 0),
        neto_servicios: Number(r.neto_servicios || 0),
        propinas: Number(r.propinas || 0),
        retenciones: 0,
        total_ciclo: Number(r.neto_servicios || 0) + Number(r.propinas || 0)
      },
      saldos: {
        disponible: Number(s.saldo_disponible || 0),
        en_custodia: Number(s.saldo_pendiente || 0),
        en_disputa: Number(s.saldo_en_disputa || 0),
        total_ganado: Number(s.total_ganado || 0),
        total_retirado: Number(s.total_retirado || 0),
        modelo_retiro: s.modelo_retiro || 'SEMANAL',
        ultimo_retiro_at: s.ultimo_retiro_at || null
      },
      servicios: detalle.rows.map((row) => ({
        booking_id: row.id,
        servicio: row.servicio,
        fecha: row.completed_at || row.scheduled_at,
        valor_servicio: Number(row.valor_bruto),
        comision: Number(row.comision_plataforma),
        retenciones: 0,
        propina: Number(row.propina || 0),
        recibes: Number(row.pago_neto_prestador) + Number(row.propina || 0)
      }))
    });
  } catch (err) {
    console.error('Error al generar estado de cuenta:', err);
    res.status(500).json({ error: 'Error al generar el estado de cuenta.' });
  }
});

// ─── WALLET — OBTENER CUENTA BANCARIA ───────────────────────────────────────

router.get('/wallet/bank-account', authMiddleware, async (req, res) => {
  if (!await requirePrestador(req, res)) return;

  try {
    const { rows } = await pool.query(
      `SELECT tipo_cuenta, banco, numero_cuenta, tipo_cuenta_bancaria, cuenta_verificada
       FROM provider_wallet
       WHERE provider_id = $1`,
      [req.user.id]
    );

    if (!rows.length || !rows[0].numero_cuenta) {
      return res.json({
        configurada: false,
        cuenta_verificada: false,
        mensaje: 'No hay cuenta bancaria configurada.'
      });
    }

    const w = rows[0];
    const enmascarada = w.numero_cuenta.length > 4
      ? `****${w.numero_cuenta.slice(-4)}`
      : '****';

    res.json({
      configurada: true,
      tipo_cuenta: w.tipo_cuenta,
      banco: w.banco,
      numero_cuenta_enmascarado: enmascarada,
      tipo_cuenta_bancaria: w.tipo_cuenta_bancaria,
      cuenta_verificada: w.cuenta_verificada
    });
  } catch (err) {
    console.error('Error al consultar cuenta bancaria:', err);
    res.status(500).json({ error: 'Error al consultar información bancaria.' });
  }
});

// ─── WALLET — REGISTRAR / ACTUALIZAR CUENTA BANCARIA ───────────────────────

const handleSaveBankAccount = async (req, res) => {
  if (!await requirePrestador(req, res)) return;

  const {
    tipo_cuenta,
    banco,
    numero_cuenta,
    tipo_cuenta_bancaria,
    titular_nombre,
    titular_documento_tipo,
    titular_documento_num
  } = req.body;

  if (!numero_cuenta || typeof numero_cuenta !== 'string' || numero_cuenta.trim().length < 6) {
    return res.status(400).json({ error: 'Número de cuenta inválido (mínimo 6 caracteres).' });
  }

  const tipoNormalizado = (tipo_cuenta || 'NEQUI').toUpperCase();
  const bancoNormalizado = (tipoNormalizado === 'NEQUI') ? 'Nequi' : (tipoNormalizado === 'DAVIPLATA') ? 'Daviplata' : (banco || 'Bancolombia');
  const tipoCuentaFinal = (tipoNormalizado === 'NEQUI' || tipoNormalizado === 'DAVIPLATA') ? tipoNormalizado : 'BANCARIA';
  const tipoBancariaFinal = (tipoNormalizado === 'CORRIENTE') ? 'CORRIENTE' : 'AHORROS';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Asegurar existencia del registro de wallet
    await client.query(
      `INSERT INTO provider_wallet (provider_id)
       VALUES ($1)
       ON CONFLICT (provider_id) DO NOTHING`,
      [req.user.id]
    );

    const datosAntesRes = await client.query(
      `SELECT tipo_cuenta, banco, numero_cuenta, tipo_cuenta_bancaria, cuenta_verificada
       FROM provider_wallet WHERE provider_id = $1`,
      [req.user.id]
    );
    const datosAntes = datosAntesRes.rows[0];

    // Actualizar datos bancarios y marcar verificada.
    // Los campos del titular se PERSISTEN: la API de Pagos a Terceros de Wompi los
    // exige (name / legalIdType / legalId) y antes solo iban al audit_log, así que
    // la dispersión real era imposible.
    const { rows } = await client.query(
      `UPDATE provider_wallet
       SET tipo_cuenta = $2,
           banco = $3,
           numero_cuenta = $4,
           tipo_cuenta_bancaria = $5,
           titular_nombre = COALESCE($6, titular_nombre),
           titular_documento_tipo = COALESCE($7, titular_documento_tipo),
           titular_documento_num = COALESCE($8, titular_documento_num),
           cuenta_verificada = TRUE,
           updated_at = NOW()
       WHERE provider_id = $1
       RETURNING tipo_cuenta, banco, numero_cuenta, tipo_cuenta_bancaria,
                 titular_nombre, titular_documento_tipo, titular_documento_num,
                 cuenta_verificada`,
      [
        req.user.id,
        tipoCuentaFinal,
        bancoNormalizado,
        numero_cuenta.trim(),
        tipoBancariaFinal,
        titular_nombre ? String(titular_nombre).trim() : null,
        titular_documento_tipo ? String(titular_documento_tipo).trim().toUpperCase() : null,
        titular_documento_num ? String(titular_documento_num).trim() : null
      ]
    );

    const cuentaActualizada = rows[0];

    // Registrar en audit_log
    await auditLog(client, {
      actorId: req.user.id,
      accion: 'CUENTA_BANCARIA_ACTUALIZADA',
      tabla: 'provider_wallet',
      registroId: req.user.id,
      datosAntes: datosAntes ? { banco: datosAntes.banco, cuenta: datosAntes.numero_cuenta ? `****${datosAntes.numero_cuenta.slice(-4)}` : null } : null,
      datosDespues: {
        banco: bancoNormalizado,
        cuenta: `****${numero_cuenta.trim().slice(-4)}`,
        tipo: tipoCuentaFinal,
        titular: titular_nombre || null,
        doc_tipo: titular_documento_tipo || null,
        doc_num: titular_documento_num ? `****${titular_documento_num.slice(-4)}` : null
      },
      ip: req.ip
    });

    await client.query('COMMIT');

    const enmascarada = cuentaActualizada.numero_cuenta.length > 4
      ? `****${cuentaActualizada.numero_cuenta.slice(-4)}`
      : '****';

    res.json({
      ok: true,
      mensaje: 'Cuenta bancaria registrada y verificada exitosamente.',
      cuenta: {
        tipo_cuenta: cuentaActualizada.tipo_cuenta,
        banco: cuentaActualizada.banco,
        numero_cuenta_enmascarado: enmascarada,
        tipo_cuenta_bancaria: cuentaActualizada.tipo_cuenta_bancaria,
        cuenta_verificada: true
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al guardar cuenta bancaria:', err);
    res.status(500).json({ error: 'Error al registrar la cuenta bancaria.' });
  } finally {
    client.release();
  }
};

router.post('/wallet/bank-account', authMiddleware, handleSaveBankAccount);
router.put('/wallet/bank-account', authMiddleware, handleSaveBankAccount);

// ─── RETIRO — SOLICITAR ───────────────────────────────────────────────────────

router.post('/wallet/withdraw', authMiddleware, async (req, res) => {
  if (!await requirePrestador(req, res)) return;

  // Fallar ANTES de debitar: si la pasarela de dispersión no está configurada, el
  // retiro no tendría forma de salir y el saldo ya habría bajado. Antes se
  // debitaba primero y la dispersión fallaba en silencio en un .catch().
  if (!wompiPayoutsClient.isConfigured()) {
    return res.status(503).json({
      error: 'PAYOUTS_NOT_CONFIGURED',
      message: 'Los retiros no están disponibles: falta configurar la dispersión con Wompi. No se debitó tu saldo.'
    });
  }

  const { monto, tipo_origen } = req.body;
  const montoSolicitado = parseFloat(monto);

  // D-GL-024: DEMANDA = retiro anticipado (mín. 100.000, con costo de
  // dispersión a cargo del prestador). SEMANAL/QUINCENA/MENSUAL = ciclo.
  const tipoOrigen = ['DEMANDA', 'SEMANAL', 'QUINCENA', 'MENSUAL']
    .includes(String(tipo_origen || '').toUpperCase())
    ? String(tipo_origen).toUpperCase()
    : 'DEMANDA';

  if (!monto || isNaN(montoSolicitado) || montoSolicitado <= 0) {
    return res.status(400).json({ error: 'Monto inválido.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT * FROM provider_wallet WHERE provider_id = $1 FOR UPDATE',
      [req.user.id]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Wallet no encontrado.' });
    }

    const wallet = rows[0];
    const minCop = parseInt(await getConfig('retiro_demanda_min_cop', '100000'));
    const diasMin = parseInt(await getConfig('retiro_demanda_dias', '7'));
    const esAnticipado = tipoOrigen === 'DEMANDA';
    const diasCiclo = tipoOrigen === 'QUINCENA' ? 15 : tipoOrigen === 'MENSUAL' ? 30 : diasMin;
    const costoFijo = parseFloat(await getConfig('retiro_costo_fijo_cop', '1849'));
    const costoPct = parseFloat(await getConfig('retiro_costo_pct', '0.4'));
    // El costo de la dispersión anticipada lo asume el prestador (D-GL-024).
    const costoRetiro = esAnticipado
      ? Math.round(costoFijo + (montoSolicitado * costoPct) / 100)
      : 0;

    if (wallet.retiros_pausados) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Tus retiros están temporalmente pausados. Contacta soporte.' });
    }

    if (!wallet.cuenta_verificada) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: 'Debes verificar tu cuenta bancaria antes de retirar.',
        accion: 'VERIFICAR_CUENTA'
      });
    }

    // D-GL-023 / F8: no se paga a un prestador sin contrato de comisión aceptado
    // ni sin aceptación de la cláusula de independencia. Antes se retenía el 20%
    // a 11 prestadores que nunca habían aceptado nada.
    const contratoRes = await client.query(
      `SELECT contrato_version, contrato_aceptado_at, independencia_aceptada_at
         FROM perfiles_prestador WHERE id = $1`,
      [req.user.id]
    );
    const perfil = contratoRes.rows[0];
    if (!perfil || !perfil.contrato_aceptado_at || !perfil.independencia_aceptada_at) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: 'Debes aceptar el contrato de comisión y la cláusula de independencia antes de retirar.',
        accion: 'ACEPTAR_CONTRATO',
        contrato_version_actual: perfil?.contrato_version || null
      });
    }

    // El mínimo aplica SOLO al anticipado: el retiro del ciclo no tiene más
    // mínimo que un monto positivo (D-GL-024).
    if (esAnticipado && montoSolicitado < minCop) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `El retiro anticipado exige un mínimo de $${minCop.toLocaleString('es-CO')} COP.`,
        minimo: minCop,
        accion: 'ESPERAR_CICLO'
      });
    }

    if (montoSolicitado > parseFloat(wallet.saldo_disponible)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Saldo disponible insuficiente.',
        disponible: wallet.saldo_disponible
      });
    }

    // El espaciado es del ciclo, no del anticipado: adelantar es potestativo y
    // se paga con la tarifa de dispersión.
    if (!esAnticipado && wallet.ultimo_retiro_at) {
      const diasTranscurridos = (Date.now() - new Date(wallet.ultimo_retiro_at)) / (1000 * 60 * 60 * 24);
      if (diasTranscurridos < diasCiclo) {
        const proximaFecha = new Date(new Date(wallet.ultimo_retiro_at).getTime() + diasCiclo * 24 * 60 * 60 * 1000);
        await client.query('ROLLBACK');
        return res.status(429).json({
          error: `Tu ciclo de retiro es cada ${diasCiclo} días. Puedes adelantarlo con la tarifa de dispersión.`,
          proxima_fecha: proximaFecha,
          accion: 'ADELANTAR_CON_COSTO'
        });
      }
    }

    // D-GL-023: una disputa congela el pago del servicio disputado, no todos los
    // retiros del prestador. El dinero en disputa ya está separado en
    // `saldo_en_disputa` al abrir el caso, así que no se bloquea el saldo maduro.

    const retiroResult = await client.query(
      `INSERT INTO retiros (provider_id, wallet_id, monto, tipo_origen, numero_cuenta, banco, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        req.user.id, wallet.id, montoSolicitado, tipoOrigen,
        wallet.numero_cuenta, wallet.banco,
        JSON.stringify({ anticipado: esAnticipado, costo_retiro: costoRetiro, costo_pct: costoPct })
      ]
    );
    const retiro = retiroResult.rows[0];

    await client.query(
      `UPDATE provider_wallet
       SET saldo_disponible = saldo_disponible - $2,
           total_retirado   = total_retirado + $2,
           ultimo_retiro_at = NOW(),
           updated_at       = NOW()
       WHERE provider_id = $1`,
      [req.user.id, montoSolicitado]
    );

    const walletActualizado = await client.query(
      'SELECT saldo_disponible + saldo_pendiente as saldo_total FROM provider_wallet WHERE provider_id = $1',
      [req.user.id]
    );
    await client.query(
      `INSERT INTO wallet_transactions
         (provider_id, tipo, monto, saldo_resultante, estado, descripcion, metadata)
       VALUES ($1, 'DEBITO_RETIRO', $2, $3, 'PENDIENTE', $4, $5)`,
      [
        req.user.id, montoSolicitado,
        parseFloat(walletActualizado.rows[0].saldo_total),
        esAnticipado ? 'Retiro anticipado solicitado' : `Retiro del ciclo ${tipoOrigen} solicitado`,
        JSON.stringify({
          retiro_id: retiro.id,
          cuenta: wallet.numero_cuenta,
          banco: wallet.banco,
          tipo_origen: tipoOrigen,
          costo_retiro: costoRetiro
        })
      ]
    );

    await auditLog(client, {
      actorId: req.user.id,
      accion: 'RETIRO_SOLICITADO',
      tabla: 'retiros',
      registroId: retiro.id,
      datosDespues: { monto: montoSolicitado, tipo: tipoOrigen, costo_retiro: costoRetiro },
      ip: req.ip
    });

    await client.query('COMMIT');

    // En el retiro anticipado el costo de la dispersión lo asume el prestador:
    // se debita el monto completo del saldo y se transfiere el neto.
    const montoADispersar = Math.max(0, montoSolicitado - costoRetiro);

    wompiService.crearPayout({
      retiroId: retiro.id,
      providerId: req.user.id,
      amount: montoADispersar,
      numeroCuenta: wallet.numero_cuenta,
      banco: wallet.banco,
      automatico: false
    }).catch(err => console.error('Error asíncrono al iniciar dispersión de retiro:', err));

    res.json({
      ok: true,
      mensaje: esAnticipado
        ? `Retiro anticipado solicitado. Recibirás $${montoADispersar.toLocaleString('es-CO')} (costo de dispersión $${costoRetiro.toLocaleString('es-CO')}).`
        : 'Retiro del ciclo solicitado. Llega en 1-2 días hábiles, sin costo.',
      retiro_id: retiro.id,
      monto: montoSolicitado,
      costo_retiro: costoRetiro,
      monto_neto: montoADispersar,
      tipo_origen: tipoOrigen,
      cuenta: `${wallet.banco} ****${wallet.numero_cuenta?.slice(-4)}`,
      estado: 'PROCESANDO'
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al procesar retiro:', err);
    res.status(500).json({ error: 'Error al procesar el retiro.' });
  } finally {
    client.release();
  }
});

// ─── WALLET — CAMBIAR MODELO DE RETIRO ───────────────────────────────────────

router.put('/wallet/model', authMiddleware, async (req, res) => {
  if (!await requirePrestador(req, res)) return;

  const { modelo } = req.body;
  // SEMANAL es el ciclo estándar (D-GL-024); DEMANDA es el adelanto con costo.
  const modelosValidos = ['SEMANAL', 'DEMANDA', 'QUINCENA', 'MENSUAL'];

  if (!modelosValidos.includes(modelo)) {
    return res.status(400).json({ error: 'Modelo inválido. Use: SEMANAL, DEMANDA, QUINCENA o MENSUAL.' });
  }

  try {
    let proximoRetiro = null;
    const ahora = new Date();
    if (modelo === 'SEMANAL') {
      // Próximo lunes.
      const delta = (1 - ahora.getDay() + 7) % 7 || 7;
      proximoRetiro = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + delta);
    } else if (modelo === 'QUINCENA') {
      const dia = ahora.getDate();
      if (dia < 15) {
        proximoRetiro = new Date(ahora.getFullYear(), ahora.getMonth(), 15);
      } else {
        proximoRetiro = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 1);
      }
    } else if (modelo === 'MENSUAL') {
      proximoRetiro = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0);
    }

    await pool.query(
      `UPDATE provider_wallet
       SET modelo_retiro = $2, proximo_retiro_auto = $3, updated_at = NOW()
       WHERE provider_id = $1`,
      [req.user.id, modelo, proximoRetiro]
    );

    res.json({
      ok: true,
      modelo,
      proximo_retiro_auto: proximoRetiro,
      mensaje: `Modelo de retiro actualizado a: ${modelo}`
    });
  } catch (err) {
    console.error('Error al cambiar modelo:', err);
    res.status(500).json({ error: 'Error al actualizar modelo de retiro.' });
  }
});

// ─── DISPUTAS — ABRIR ─────────────────────────────────────────────────────────

router.post('/disputes', authMiddleware, async (req, res) => {
  const { booking_id, tipo, descripcion, evidencia_urls } = req.body;

  if (!booking_id || !tipo) {
    return res.status(400).json({ error: 'Se requieren booking_id y tipo de disputa.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT b.*, u_c.rol as rol_cliente, u_p.rol as rol_prestador
       FROM bookings b
       JOIN usuarios u_c ON b.client_id = u_c.id
       JOIN usuarios u_p ON b.provider_id = u_p.id
       WHERE b.id = $1 AND (b.client_id = $2 OR b.provider_id = $2)`,
      [booking_id, req.user.id]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Reserva no encontrada.' });
    }

    const booking = rows[0];
    const userRow = await client.query('SELECT rol FROM usuarios WHERE id = $1', [req.user.id]);
    const rolActor = userRow.rows[0].rol;

    if (rolActor === 'CLIENTE' && booking.estado === 'COMPLETADA') {
      // D-GL-023: la ventana es de 48 h desde la finalización del servicio, no
      // desde el uso del OTP (que podía ocurrir minutos después).
      const ventanaHoras = parseInt(await getConfig('disputa_ventana_horas', '48'));

      let finServicio = booking.completed_at ? new Date(booking.completed_at) : null;
      if (!finServicio) {
        const otpResult = await client.query(
          `SELECT usado_at FROM otp_validaciones WHERE booking_id = $1 AND estado = 'USADO'`,
          [booking_id]
        );
        if (otpResult.rows.length && otpResult.rows[0].usado_at) {
          finServicio = new Date(otpResult.rows[0].usado_at);
        }
      }

      if (finServicio) {
        const horasTranscurridas = (Date.now() - finServicio.getTime()) / (1000 * 60 * 60);
        if (horasTranscurridas > ventanaHoras) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: `La ventana de disputa (${ventanaHoras} h desde la finalización) ha expirado.`,
            finalizado_at: finServicio.toISOString()
          });
        }
      }
    }

    const dispExistente = await client.query(
      `SELECT id FROM disputas WHERE booking_id = $1 AND estado NOT IN ('RESUELTA','CERRADA')`,
      [booking_id]
    );
    if (dispExistente.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Ya existe una disputa abierta para esta reserva.' });
    }

    const slaDias = parseInt(await getConfig('disputa_sla_dias', '5'));

    const disputaResult = await client.query(
      `INSERT INTO disputas
         (booking_id, iniciado_por, tipo_actor, tipo, descripcion, evidencia_urls, monto_disputado, sla_limite_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + ($8 || ' days')::interval)
       RETURNING *`,
      [booking_id, req.user.id, rolActor, tipo, descripcion, evidencia_urls || [], booking.valor_bruto, slaDias]
    );

    await client.query(
      `UPDATE bookings SET estado = 'EN_DISPUTA' WHERE id = $1`,
      [booking_id]
    );

    if (booking.estado === 'COMPLETADA') {
      const montoCongelar = parseFloat(booking.pago_neto_prestador);
      await client.query(
        `UPDATE provider_wallet
         SET saldo_disponible = GREATEST(0, saldo_disponible - $2),
             saldo_en_disputa = saldo_en_disputa + $2,
             updated_at = NOW()
         WHERE provider_id = $1`,
        [booking.provider_id, montoCongelar]
      );
      await client.query(
        `INSERT INTO wallet_transactions
           (provider_id, booking_id, tipo, monto, saldo_resultante, estado, descripcion)
         SELECT $1, $2, 'RETENCION_DISPUTA', $3, saldo_disponible + saldo_pendiente,
                'COMPLETADO', 'Fondos congelados por disputa'
         FROM provider_wallet WHERE provider_id = $1`,
        [booking.provider_id, booking_id, montoCongelar]
      );
    }

    await auditLog(client, {
      actorId: req.user.id,
      accion: 'DISPUTA_ABIERTA',
      tabla: 'disputas',
      registroId: disputaResult.rows[0].id,
      datosDespues: { tipo, monto: booking.valor_bruto },
      ip: req.ip
    });

    await client.query('COMMIT');

    res.status(201).json({
      ok: true,
      mensaje: `Disputa registrada. El pago queda congelado y se resuelve en máximo ${slaDias} días.`,
      disputa: disputaResult.rows[0]
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al abrir disputa:', err);
    res.status(500).json({ error: 'Error al registrar la disputa.' });
  } finally {
    client.release();
  }
});

// ─── ADMIN — DASHBOARD FINANCIERO ────────────────────────────────────────────

router.get('/admin/dashboard', authMiddleware, async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const [financiero, disputas, alertas] = await Promise.all([
      pool.query(`
        SELECT
          COALESCE(SUM(valor_bruto), 0)        as recaudado_hoy,
          COALESCE(SUM(pago_neto_prestador), 0) as dispersado_hoy,
          COALESCE(SUM(comision_plataforma), 0) as comision_hoy,
          COUNT(*)                              as servicios_hoy
        FROM bookings
        WHERE DATE(created_at) = CURRENT_DATE AND estado = 'COMPLETADA'
      `),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE estado = 'ABIERTA')      as abiertas,
          COUNT(*) FILTER (WHERE estado = 'EN_REVISION')  as en_revision,
          COUNT(*) FILTER (WHERE sla_limite_at < NOW() AND estado IN ('ABIERTA','EN_REVISION')) as vencidas_sla
        FROM disputas
      `),
      pool.query(`
        SELECT
          COALESCE(SUM(saldo_disponible), 0) as total_wallets,
          COALESCE(SUM(saldo_pendiente), 0)  as total_pendiente,
          COALESCE(SUM(saldo_en_disputa), 0) as total_en_disputa,
          COUNT(*) FILTER (WHERE risk_score > 40) as prestadores_riesgo
        FROM provider_wallet
      `)
    ]);

    res.json({
      financiero: financiero.rows[0],
      disputas: disputas.rows[0],
      wallets: alertas.rows[0]
    });
  } catch (err) {
    console.error('Error en dashboard admin:', err);
    res.status(500).json({ error: 'Error al obtener métricas.' });
  }
});

// ─── ADMIN — LISTAR DISPUTAS ──────────────────────────────────────────────────

router.get('/admin/disputes', authMiddleware, async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const estado = req.query.estado || 'ABIERTA';
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const offset = (page - 1) * limit;

  try {
    const { rows } = await pool.query(
      `SELECT d.*,
              u_i.nombre as iniciado_por_nombre,
              b.valor_bruto, b.provider_id, b.client_id,
              u_c.nombre as cliente_nombre,
              u_p.nombre as prestador_nombre,
              s.name as servicio_nombre,
              EXTRACT(EPOCH FROM (NOW() - d.creado_at))/3600 as horas_abierta,
              d.sla_limite_at < NOW() as sla_vencido
       FROM disputas d
       JOIN usuarios u_i ON d.iniciado_por = u_i.id
       JOIN bookings b ON d.booking_id = b.id
       JOIN usuarios u_c ON b.client_id = u_c.id
       JOIN usuarios u_p ON b.provider_id = u_p.id
       LEFT JOIN services s ON b.service_id = s.id
       WHERE d.estado = $1
       ORDER BY d.sla_limite_at ASC
       LIMIT $2 OFFSET $3`,
      [estado, limit, offset]
    );

    res.json({ disputas: rows, page, limit });
  } catch (err) {
    console.error('Error al listar disputas:', err);
    res.status(500).json({ error: 'Error al obtener disputas.' });
  }
});

// ─── ADMIN — RESOLVER DISPUTA ─────────────────────────────────────────────────

router.put('/admin/disputes/:id/resolve', authMiddleware, async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const { id } = req.params;
  const { resolucion, porcentaje_prestador, nota_resolucion } = req.body;

  const resolucionesValidas = ['FAVOR_PRESTADOR', 'REEMBOLSO_TOTAL', 'DIVISION', 'COMPENSACION_PLATAFORMA'];
  if (!resolucionesValidas.includes(resolucion)) {
    return res.status(400).json({ error: 'Resolución inválida.' });
  }
  if (resolucion === 'DIVISION' && (porcentaje_prestador === undefined || porcentaje_prestador < 0 || porcentaje_prestador > 100)) {
    return res.status(400).json({ error: 'Para DIVISION se requiere porcentaje_prestador (0-100).' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT d.*, b.provider_id, b.client_id, b.pago_neto_prestador, b.valor_bruto
       FROM disputas d JOIN bookings b ON d.booking_id = b.id
       WHERE d.id = $1 AND d.estado IN ('ABIERTA','EN_REVISION')`,
      [id]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Disputa no encontrada o ya resuelta.' });
    }

    const disputa = rows[0];
    const montoEnDisputa = parseFloat(disputa.pago_neto_prestador);

    let montoPrestador = 0;
    let montoReembolso = 0;

    switch (resolucion) {
      case 'FAVOR_PRESTADOR':
        montoPrestador = montoEnDisputa;
        break;
      case 'REEMBOLSO_TOTAL':
        montoReembolso = parseFloat(disputa.valor_bruto);
        break;
      case 'DIVISION':
        montoPrestador = (montoEnDisputa * porcentaje_prestador) / 100;
        montoReembolso = montoEnDisputa - montoPrestador;
        break;
      case 'COMPENSACION_PLATAFORMA':
        montoReembolso = parseFloat(disputa.valor_bruto);
        montoPrestador = 0;
        break;
    }

    await client.query(
      `UPDATE provider_wallet
       SET saldo_en_disputa  = GREATEST(0, saldo_en_disputa - $2),
           saldo_disponible  = saldo_disponible + $3,
           updated_at        = NOW()
       WHERE provider_id = $1`,
      [disputa.provider_id, montoEnDisputa, montoPrestador]
    );

    if (montoPrestador > 0) {
      await client.query(
        `INSERT INTO wallet_transactions
           (provider_id, booking_id, tipo, monto, saldo_resultante, estado, descripcion)
         SELECT $1, $2, 'LIBERACION_DISPUTA', $3, saldo_disponible + saldo_pendiente,
                'COMPLETADO', $4
         FROM provider_wallet WHERE provider_id = $1`,
        [disputa.provider_id, disputa.booking_id, montoPrestador,
         `Disputa resuelta: ${resolucion}. Fondos liberados.`]
      );
    }

    // ✅ BUG FIX: eliminado 'actualizado_at'/'updated_at' — columna no existe en tabla disputas
    await client.query(
      `UPDATE disputas
       SET estado = 'RESUELTA', resolucion = $2, porcentaje_prestador = $3,
           nota_resolucion = $4, resuelto_por = $5, resuelto_at = NOW()
       WHERE id = $1`,
      [id, resolucion, porcentaje_prestador || null, nota_resolucion || null, req.user.id]
    );

    await client.query(
      `UPDATE bookings SET estado = $2 WHERE id = $1`,
      [disputa.booking_id, resolucion === 'REEMBOLSO_TOTAL' ? 'CANCELADA' : 'COMPLETADA']
    );

    await auditLog(client, {
      actorId: req.user.id,
      accion: 'DISPUTA_RESUELTA',
      tabla: 'disputas',
      registroId: id,
      datosAntes: { estado: 'ABIERTA' },
      datosDespues: { resolucion, monto_prestador: montoPrestador, monto_reembolso: montoReembolso },
      ip: req.ip
    });

    await client.query('COMMIT');

    res.json({
      ok: true,
      mensaje: 'Disputa resuelta exitosamente.',
      resolucion,
      monto_liberado_prestador: montoPrestador,
      monto_reembolso_cliente: montoReembolso
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al resolver disputa:', err);
    res.status(500).json({ error: 'Error al resolver la disputa.' });
  } finally {
    client.release();
  }
});

wrapRouterAsync(router);
module.exports = router;

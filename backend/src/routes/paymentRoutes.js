const { wrapRouterAsync } = require('../utils/expressAsync');
// backend/src/routes/paymentRoutes.js
// Sistema completo de pagos: OTP, Wallet, Retiros, Disputas

const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const router = express.Router();
const { pool } = require('../config/db');
const { runAsSystemContext, runAsSystem } = require('../config/tenantRouting');
const otpCrypto = require('../utils/otpCrypto');
const emailService = require('../services/emailService');
const fcm = require('../services/fcmNotificationService');
const { authMiddleware } = require('../middleware/auth');
const { paymentLimiter, otpLimiter } = require('../middleware/rateLimiter');
const { exigirCapacidad } = require('../middleware/exigirCapacidad');
const { CAPACIDADES } = require('../services/capacidadesProveedor');
const saasContext = require('../middleware/saasContext');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const wompiService = require('../services/wompiService');
const wompiClient = require('../services/wompiClient');
const wompiPayoutsClient = require('../services/wompiPayoutsClient');
const { aCentavos, aDecimal, sumarMontos } = require('../utils/money');
const { OAuth2Client } = require('google-auth-library');
const { notifyDisputeUsers } = require('../services/disputeNotifications');
const { validarEvidencias } = require('../utils/disputaEvidencias');
const payoutData = require('../services/payoutSensitiveDataService');
const { canManageBooking } = require('../utils/bookingAccess');
const { AuthorizationService, RESOURCES, ACTIONS } = require('../services/authorizationService');

const exigirCapacidadReservasPrestador = exigirCapacidad(CAPACIDADES.RECIBIR_RESERVAS);

function autorizarOperacionReserva(req, res, next) {
  if (AuthorizationService.can(req.saas?.role, RESOURCES.BOOKING, ACTIONS.CONFIRM_BOOKING)) {
    return next();
  }
  return exigirCapacidadReservasPrestador(req, res, next);
}

const payoutEvidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1500000, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/png'].includes(file.mimetype)),
});

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

async function notificarEventoSeguridadRetiros(providerId, { subject, title, body, tipo }) {
  try {
    const contacto = await runAsSystem({ pool }, async (c) => {
      const result = await c.query(
        'SELECT email, email_verificado, fcm_token FROM usuarios WHERE id = $1',
        [providerId]
      );
      return result.rows[0] || null;
    });
    if (contacto?.email && contacto.email_verificado === true &&
        (process.env.BREVO_API_KEY || emailService.initEmailService())) {
      await emailService.sendEmail({
        to: contacto.email,
        subject,
        data: { html: `<p>${body}</p><p>Si no reconoces esta acción, congela los retiros y contacta a soporte.</p>` }
      });
    }
    if (contacto?.fcm_token && fcm.initialized) {
      await fcm.sendPushNotification(contacto.fcm_token, {
        title, body, data: { type: tipo }
      });
    }
  } catch (err) {
    console.error('[PAYOUT SECURITY] No se pudo enviar la notificación:', err.message);
  }
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


router.post(
  '/bookings/:id/checkin',
  authMiddleware,
  saasContext,
  autorizarOperacionReserva,
  async (req, res) => {
  const { id } = req.params;
  const { latitud, longitud } = req.body;
  const latitude = Number(latitud);
  const longitude = Number(longitud);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: 'Se requieren coordenadas GPS para el check-in.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_system');
    if (!(await canManageBooking(req, id, client, ACTIONS.CONFIRM_BOOKING))) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Reserva no encontrada o no disponible para check-in.' });
    }

    const { rows } = await client.query(
      `SELECT b.*, u.nombre as cliente_nombre
       FROM bookings b
       JOIN usuarios u ON b.client_id = u.id
       WHERE b.id = $1 AND b.estado = 'CONFIRMADA' FOR UPDATE OF b`,
      [id]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Reserva no encontrada o no disponible para check-in.' });
    }

    const configResult = await client.query('SELECT value FROM platform_config WHERE key = $1', ['gps_tolerancia_metros']);
    const tolerancia = parseInt(configResult.rows[0]?.value || '500', 10);
    const booking = rows[0];

    // La tolerancia se leía y nunca se validaba: el check-in era decorativo.
    // Si la reserva tiene coordenadas de referencia, se exige estar dentro del
    // radio. Si no las tiene, se registra el punto y se marca como no validado
    // (la dirección estructurada no se puede geocodificar aquí).
    const distancia = distanciaMetros(
      latitude, longitude,
      booking.service_lat != null ? Number(booking.service_lat) : null,
      booking.service_lng != null ? Number(booking.service_lng) : null
    );

    if (distancia !== null && distancia > tolerancia) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Estás a ${Math.round(distancia)} m del punto del servicio. El máximo permitido es ${tolerancia} m.`,
        distancia_metros: Math.round(distancia),
        tolerancia_metros: tolerancia
      });
    }

    await client.query(
      `UPDATE bookings SET estado = 'CHECKIN_REALIZADO',
       checkin_lat = $3, checkin_lng = $4, checkin_at = NOW(),
       notes = COALESCE(notes, '') || $5
       WHERE id = $1 AND estado = 'CONFIRMADA'`,
      [
        id, req.user.id, latitude, longitude,
        ` [CHECKIN: ${latitud},${longitud}${distancia !== null ? ` @ ${Math.round(distancia)}m` : ' (sin referencia)'} @ ${new Date().toISOString()}]`
      ]
    );
    await client.query('COMMIT');

    res.json({
      ok: true,
      mensaje: 'Check-in registrado. Puedes comenzar el servicio.',
      tolerancia_metros: tolerancia,
      distancia_metros: distancia !== null ? Math.round(distancia) : null,
      gps_validado: distancia !== null
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* la transacción pudo cerrarse */ }
    console.error('Error en check-in:', err);
    res.status(500).json({ error: 'Error al registrar check-in.' });
  } finally {
    client.release();
  }
});

// ─── VER EL CÓDIGO OTP (el propio cliente) ───────────────────────────────────
//
// Entrega en la app, coste cero. El código se genera cuando el prestador termina
// el servicio y sin esto solo podía llegar por correo, que exige un proveedor de
// pago. Es el modelo de un PIN de viaje: lo ve quien tiene que usarlo, en su
// propia cuenta, y el prestador no.
router.get('/bookings/:id/otp', authMiddleware, otpLimiter, async (req, res) => {
  try {
    const { id } = req.params;

    const datos = await runAsSystem({ pool }, async (c) => {
      const r = await c.query(
        `SELECT b.client_id, ov.codigo_cifrado, ov.estado, ov.expira_at, b.estado AS booking_estado
           FROM otp_validaciones ov
           JOIN bookings b ON b.id = ov.booking_id
          WHERE ov.booking_id = $1`,
        [id]
      );
      return r.rows[0] || null;
    });

    if (!datos) {
      return res.status(404).json({ error: 'Esta cita todavía no tiene un código de confirmación.' });
    }
    if (String(datos.client_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Solo el cliente de la reserva puede ver el código.' });
    }
    if (datos.estado !== 'ACTIVO' || new Date(datos.expira_at) < new Date()) {
      return res.status(410).json({ error: 'El código venció. Pide al prestador que lo reenvíe.' });
    }
    if (!datos.codigo_cifrado) {
      return res.status(409).json({ error: 'El código no está disponible en la app; revisa tu correo.' });
    }

    return res.json({
      ok: true,
      codigo: otpCrypto.descifrar(datos.codigo_cifrado),
      expira_at: datos.expira_at,
      booking_estado: datos.booking_estado,
    });
  } catch (err) {
    console.error('❌ ERROR GET /api/bookings/:id/otp:', err.message);
    res.status(500).json({ error: 'No se pudo obtener el código.' });
  }
});

// ─── COMPLETAR SERVICIO → GENERAR OTP ────────────────────────────────────────

router.post(
  '/bookings/:id/complete',
  authMiddleware,
  saasContext,
  autorizarOperacionReserva,
  async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // El prestador y el cliente viven en inquilinos distintos: RLS oculta la
    // reserva y su cliente. Se escala esta transacción y se comprueba titular o
    // membresía operativa + sede activa antes de emitir el OTP.
    await client.query('SET LOCAL ROLE app_system');

    if (!(await canManageBooking(req, id, client, ACTIONS.CONFIRM_BOOKING))) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Reserva no encontrada o sin permisos para completarla.' });
    }

    const { rows } = await client.query(
      `SELECT b.*, u.email as cliente_email, u.nombre as cliente_nombre
       FROM bookings b
       JOIN usuarios u ON b.client_id = u.id
       WHERE b.id = $1
         AND b.estado IN ('CONFIRMADA', 'CHECKIN_REALIZADO', 'EN_PROGRESO')`,
      [id]
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
      `INSERT INTO otp_validaciones (booking_id, codigo_hash, codigo_cifrado, expira_at, ip_generacion)
       VALUES ($1, $2, $5, $3, $4)
       ON CONFLICT (booking_id) DO UPDATE
         SET codigo_hash = $2, codigo_cifrado = $5, expira_at = $3, estado = 'ACTIVO',
             intentos_fallidos = 0, usado_at = NULL`,
      [id, hash, expiraAt, req.ip, otpCrypto.cifrar(codigo)]
    );

    await client.query(
      `UPDATE bookings SET estado = 'ESPERANDO_OTP' WHERE id = $1`,
      [id]
    );

    await client.query('COMMIT');

    // ── Entrega del código ───────────────────────────────────────────────────
    let correoEnviado = false;
    let pushEnviado = false;
    try {
      // El mailer admite SMTP y API HTTP de Brevo. Sin ninguno no llamamos al
      // fallback de desarrollo, porque registra el cuerpo completo del correo.
      const contacto = await runAsSystem({ pool }, async (c) => {
        const r = await c.query(
          'SELECT email, nombre FROM usuarios WHERE id = $1',
          [booking.client_id]
        );
        return r.rows[0] || null;
      });
      const destinatario = contacto || (booking.cliente_email
        ? { email: booking.cliente_email, nombre: booking.cliente_nombre }
        : null);

      const tieneTransporte = Boolean(
        process.env.BREVO_API_KEY || emailService.initEmailService()
      );
      if (destinatario?.email && tieneTransporte) {
        try {
          const resultadoEmail = await emailService.sendEmail({
            to: destinatario.email,
            subject: 'Tu código para confirmar el servicio · GlowApp',
            data: {
              html: `
                <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1F1A15">
                  <h2 style="margin:0 0 8px;font-size:20px">Confirma tu servicio</h2>
                  <p style="margin:0 0 20px;color:#6B6157;font-size:14px">
                    Hola ${destinatario.nombre || ''}, tu prestador marcó el servicio como terminado.
                    Ingresa este código en GlowApp para confirmar y liberar el pago.
                  </p>
                  <div style="font-size:34px;letter-spacing:10px;font-weight:bold;color:#C5A052;text-align:center;padding:16px 0;border-top:1px solid #EFE8DE;border-bottom:1px solid #EFE8DE">
                    ${codigo}
                  </div>
                  <p style="margin:20px 0 0;color:#8A7F72;font-size:12px">
                    Vence en ${vigenciaMin} minutos. Si no reconoces este servicio, abre una disputa desde la app.
                  </p>
                </div>`,
            },
          });
          correoEnviado = !resultadoEmail?.devMode && !resultadoEmail?.simulated;
          if (correoEnviado) {
            console.log(`[OTP] Código aceptado para envío por correo a ${destinatario.email.replace(/(.).*(@.*)/, '$1***$2')}`);
          } else {
            console.warn('[OTP] El proveedor de correo no confirmó un envío real.');
          }
        } catch (emailErr) {
          console.error('[OTP] Falló el envío por correo:', emailErr.message);
        }
      } else if (!destinatario?.email) {
        console.warn('[OTP] El cliente no tiene correo registrado:', booking.client_id);
      } else {
        console.warn('[OTP] No hay transporte de correo configurado; no se envió el código.');
      }

      // La push avisa que el código está disponible en la app, pero no lo incluye.
      try {
        const tokenRes = await runAsSystem({ pool }, async (c) => {
          const r = await c.query(
            'SELECT fcm_token FROM usuarios WHERE id = $1',
            [booking.client_id]
          );
        return r.rows[0] || (booking.fcm_token ? { fcm_token: booking.fcm_token } : null);
        });
        if (tokenRes?.fcm_token) {
          const resultadoPush = await fcm.sendOtpReadyNotice(tokenRes.fcm_token, {
            bookingId: id,
            serviceName: booking.service_name || null,
          });
          pushEnviado = resultadoPush?.success === true && !resultadoPush?.simulated;
        }
      } catch (pushErr) {
        console.warn('[OTP] Aviso push no enviado:', pushErr.message);
      }
    } catch (envioErr) {
      console.error('[OTP] No se pudo completar la entrega:', envioErr.message);
    }

    // El código OTP no se registra en logs (A360-2026-09-22/C-06) ni se devuelve al cliente
    // salvo opt-in explícito de desarrollo: antes bastaba con que NODE_ENV no fuera exactamente 'production'.

    res.json({
      ok: true,
      mensaje: correoEnviado
        ? 'Servicio completado. El código se envió por correo y está disponible en GlowApp.'
        : 'Servicio completado. El envío por correo no está confirmado; el código está disponible en GlowApp.',
      correo_enviado: correoEnviado,
      push_enviado: pushEnviado,
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

router.post(
  '/bookings/:id/confirm-otp',
  authMiddleware,
  exigirCapacidad(CAPACIDADES.RECIBIR_RESERVAS),
  async (req, res) => {
  const { id } = req.params;
  const { codigo } = req.body;

  if (!codigo || !/^\d{6}$/.test(codigo)) {
    return res.status(400).json({ error: 'El código debe ser de 6 dígitos numéricos.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // El OTP lo inserta el prestador (su inquilino) y lo confirma el cliente
    // (otro): con el contexto del cliente la fila es invisible y la confirmacion
    // daba 404 teniendo el codigo correcto. Quien tiene derecho a confirmar se
    // comprueba abajo comparando con el client_id de la reserva.
    await client.query('SET LOCAL ROLE app_system');

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

        // 🔹 Enviar correo de confirmación de pago (fuera de la transacción, best-effort)
        // Idempotencia: verificar que el pago no estaba ya en 'paid' antes de esta confirmación
        try {
          const emailService = require('../services/emailService');
          const bookingCheck = await pool.query(
            `SELECT b.*, u.email as cliente_email, u.nombre as cliente_nombre,
                    s.name as servicio_nombre, p.nombre as prestador_nombre
             FROM bookings b
             JOIN usuarios u ON b.client_id = u.id
             LEFT JOIN services s ON b.service_id = s.id
             LEFT JOIN usuarios p ON b.provider_id = p.id
             WHERE b.id = $1`,
            [id]
          );
          const booking = bookingCheck.rows[0];
          if (booking?.cliente_email && booking.payment_status === 'paid') {
            const fechaFormateada = booking.scheduled_at
              ? new Date(booking.scheduled_at).toLocaleString('es-CO', {
                  dateStyle: 'long',
                  timeStyle: 'short',
                  timeZone: 'America/Bogota',
                })
              : '—';
            const refCorta = String(id).slice(0, 8).toUpperCase();
            const result = await emailService.sendBookingConfirmationEmail({
              toEmail: booking.cliente_email,
              clientName: booking.cliente_nombre || 'Cliente',
              bookingId: id,
              serviceName: booking.servicio_nombre || booking.service_name || 'Servicio',
              providerName: booking.prestador_nombre || 'Prestador',
              appointmentDate: fechaFormateada,
              paymentMethod: 'Wompi (OTP)',
              amount: '$' + Number(booking.valor_bruto || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 }),
              reference: refCorta,
            });
            console.log(`📧 [OTP CONFIRMACIÓN] Correo de confirmación enviado (booking_id=${id}, messageId=${result?.messageId || 'dev'})`);
          }
        } catch (emailErr) {
          console.error(`[OTP CONFIRMACIÓN] Error enviando correo de confirmación (no bloquea):`, emailErr.message);
        }

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
              u.auth_provider,
              (u.password_hash IS NOT NULL) AS tiene_password,
              (SELECT COUNT(*) FROM disputas d
               JOIN bookings b ON d.booking_id = b.id
               WHERE b.provider_id = $1 AND d.estado IN ('ABIERTA','EN_REVISION')) as disputas_activas
       FROM provider_wallet pw
       JOIN usuarios u ON u.id = pw.provider_id
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
        ultimo_retiro_at: null, cuenta_verificada: false, retiros_pausados: false,
        cuenta_estado_verificacion: 'PENDIENTE', cuenta_cambio_cancelable: false,
        cuenta_retiros_bloqueados_hasta: null
      });
    }

    const wallet = payoutData.decryptWallet(rows[0]);

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

    const cooldownHasta = wallet.cuenta_retiros_bloqueados_hasta
      ? new Date(wallet.cuenta_retiros_bloqueados_hasta)
      : null;
    if (wallet.retiros_pausados) {
      razon_bloqueo = 'Tu cuenta tiene retiros pausados. Contacta soporte.';
    } else if (cooldownHasta && cooldownHasta.getTime() > Date.now()) {
      razon_bloqueo = `Cambio de cuenta en protección. Retiros habilitados después del ${cooldownHasta.toLocaleString('es-CO')}.`;
    } else if (wallet.cuenta_verificada !== true || wallet.cuenta_estado_verificacion === 'PENDIENTE') {
      razon_bloqueo = wallet.banco
        ? 'Tu cuenta de retiro está pendiente de validación.'
        : 'Vincula una cuenta de retiro validada para retirar saldo.';
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

    const walletPublico = { ...wallet };
    for (const key of Object.keys(walletPublico)) {
      if (key.startsWith('cuenta_anterior_')) delete walletPublico[key];
    }
    if (walletPublico.numero_cuenta) {
      walletPublico.numero_cuenta_enmascarado = `****${String(walletPublico.numero_cuenta).slice(-4)}`;
    }
    delete walletPublico.numero_cuenta;
    delete walletPublico.titular_nombre;
    delete walletPublico.titular_documento_num;
    res.json({
      ...walletPublico,
      cuenta_cambio_cancelable: wallet.cuenta_estado_verificacion === 'PENDIENTE' && Boolean(wallet.banco),
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

// El identificador no contiene datos personales y permite calcular abandono,
// tiempo de revisión y aperturas de soporte del flujo del prestador.
router.post('/wallet/bank-account/flow-session', authMiddleware, async (req, res) => {
  if (!await requirePrestador(req, res)) return;
  try {
    await pool.query(
      `UPDATE payout_account_flow_sessions
          SET status = 'ABANDONED', closed_at = COALESCE(closed_at, NOW())
        WHERE provider_id = $1 AND status = 'OPEN'
          AND started_at < NOW() - INTERVAL '30 minutes'`,
      [req.user.id]
    );
    let result = await pool.query(
      `SELECT id FROM payout_account_flow_sessions
        WHERE provider_id = $1 AND status = 'OPEN'
          AND started_at >= NOW() - INTERVAL '30 minutes'
        ORDER BY started_at DESC LIMIT 1`,
      [req.user.id]
    );
    if (!result.rows.length) {
      result = await pool.query(
        `INSERT INTO payout_account_flow_sessions (provider_id, tenant_id)
         VALUES ($1, $2) RETURNING id`,
        [req.user.id, req.user.tenant_id || null]
      );
    }
    return res.status(201).json({ flow_session_id: result.rows[0].id });
  } catch (error) {
    console.error('[PAYOUT FLOW] No se pudo abrir la sesión:', error.message);
    return res.status(500).json({ error: 'No se pudo iniciar el flujo de cuenta.' });
  }
});

router.post('/wallet/bank-account/flow-session/:id/support-opened', authMiddleware, async (req, res) => {
  if (!await requirePrestador(req, res)) return;
  if (!/^[0-9a-f-]{36}$/i.test(String(req.params.id || ''))) {
    return res.status(400).json({ error: 'Sesión de flujo inválida.' });
  }
  try {
    const result = await pool.query(
      `UPDATE payout_account_flow_sessions
          SET support_opened_at = COALESCE(support_opened_at, NOW())
        WHERE id = $1 AND provider_id = $2 AND status IN ('OPEN', 'SUBMITTED')
        RETURNING id`,
      [req.params.id, req.user.id]
    );
    return result.rowCount
      ? res.json({ ok: true })
      : res.status(404).json({ error: 'Sesión de flujo no encontrada.' });
  } catch (error) {
    console.error('[PAYOUT FLOW] No se pudo registrar apertura de soporte:', error.message);
    return res.status(500).json({ error: 'No se pudo registrar la acción.' });
  }
});

router.post('/wallet/bank-account/flow-session/:id/close', authMiddleware, async (req, res) => {
  if (!await requirePrestador(req, res)) return;
  if (!/^[0-9a-f-]{36}$/i.test(String(req.params.id || ''))) {
    return res.status(400).json({ error: 'Sesión de flujo inválida.' });
  }
  try {
    await pool.query(
      `UPDATE payout_account_flow_sessions
          SET status = 'ABANDONED', closed_at = COALESCE(closed_at, NOW())
        WHERE id = $1 AND provider_id = $2 AND status = 'OPEN'`,
      [req.params.id, req.user.id]
    );
    return res.json({ ok: true });
  } catch (error) {
    console.error('[PAYOUT FLOW] No se pudo cerrar la sesión:', error.message);
    return res.status(500).json({ error: 'No se pudo registrar el cierre.' });
  }
});

router.post('/wallet/bank-account/evidence/:id', authMiddleware, (req, res, next) => {
  payoutEvidenceUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera 1,5 MB.' : 'Adjunta una imagen JPG o PNG válida.' });
    next();
  });
}, async (req, res) => {
  if (!await requirePrestador(req, res)) return;
  if (!/^[0-9a-f-]{36}$/i.test(String(req.params.id || '')) || !req.file) {
    return res.status(400).json({ error: 'Solicitud o archivo inválido.' });
  }
  const bytes = req.file.buffer;
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if ((req.file.mimetype === 'image/jpeg' && !isJpeg) || (req.file.mimetype === 'image/png' && !isPng)) {
    return res.status(400).json({ error: 'El contenido no coincide con el formato de imagen declarado.' });
  }
  let sanitizedBytes;
  try {
    const image = sharp(bytes, { limitInputPixels: 20000000 }).rotate();
    sanitizedBytes = req.file.mimetype === 'image/png'
      ? await image.png({ compressionLevel: 9 }).toBuffer()
      : await image.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  } catch (_) {
    return res.status(400).json({ error: 'La imagen está dañada o no se puede procesar.' });
  }
  if (!sanitizedBytes.length || sanitizedBytes.length > 1500000) {
    return res.status(400).json({ error: 'La imagen procesada supera 1,5 MB. Reduce su tamaño e inténtalo de nuevo.' });
  }
  const storedMimeType = req.file.mimetype;
  try {
    const client = await pool.connect();
    let result;
    try {
      await client.query('BEGIN');
      if (req.user.tenant_id) {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(req.user.tenant_id)]);
      }
      await client.query("SELECT set_config('app.user_id', $1, true)", [String(req.user.id)]);
      const evidence = await client.query(
        `SELECT e.id, e.account_fingerprint, pw.tipo_cuenta, pw.banco,
                pw.tipo_cuenta_bancaria, pw.numero_cuenta
           FROM payout_account_review_evidence e
           JOIN provider_wallet pw ON pw.provider_id = e.provider_id
          WHERE e.id = $1 AND e.provider_id = $2 AND e.status = 'REQUESTED'
          FOR UPDATE OF e, pw`, [req.params.id, req.user.id]
      );
      const row = evidence.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'No hay una solicitud vigente para esta cuenta. Contacta al equipo de revisión.' });
      }
      const wallet = payoutData.decryptWallet(row);
      const fingerprint = payoutData.fingerprint([
        wallet.tipo_cuenta, wallet.banco, wallet.tipo_cuenta_bancaria, wallet.numero_cuenta,
      ].join('|'));
      if (fingerprint !== row.account_fingerprint) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'La cuenta cambió después de la solicitud. Solicita una nueva revisión.' });
      }
      result = await client.query(
        `UPDATE payout_account_review_evidence
            SET status = 'UPLOADED', file_ciphertext = $2, file_mime_type = $3,
                file_bytes = $4, uploaded_at = NOW(), purge_at = NOW() + INTERVAL '30 days'
          WHERE id = $1 AND status = 'REQUESTED' RETURNING id`,
        [req.params.id, payoutData.encrypt(sanitizedBytes.toString('base64')), storedMimeType, sanitizedBytes.length]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    if (!result?.rowCount) return res.status(409).json({ error: 'La solicitud de soporte ya no está vigente.' });
    return res.json({ ok: true, estado: 'UPLOADED' });
  } catch (error) {
    console.error('[PAYOUT EVIDENCE] No se pudo guardar el soporte:', error.message);
    return res.status(500).json({ error: 'No se pudo guardar el soporte de forma segura.' });
  }
});

router.get('/wallet/bank-account', authMiddleware, async (req, res) => {
  if (!await requirePrestador(req, res)) return;

  try {
    const { rows } = await pool.query(
      `SELECT tipo_cuenta, banco, numero_cuenta, tipo_cuenta_bancaria,
              cuenta_verificada, cuenta_estado_verificacion,
              cuenta_cambio_solicitado_at, cuenta_retiros_bloqueados_hasta,
              (cuenta_estado_verificacion = 'PENDIENTE' AND banco IS NOT NULL) AS cuenta_cambio_cancelable
       FROM provider_wallet
       WHERE provider_id = $1`,
      [req.user.id]
    );

    if (!rows.length || !rows[0].numero_cuenta) {
      return res.json({
        configurada: false,
        cuenta_verificada: false,
        estado_verificacion: 'PENDIENTE',
        mensaje: 'No hay cuenta bancaria configurada.'
      });
    }

    const w = payoutData.decryptWallet(rows[0]);
    const enmascarada = w.numero_cuenta.length > 4
      ? `****${w.numero_cuenta.slice(-4)}`
      : '****';
    const slaHoras = Math.max(1, Math.min(720, parseInt(await getConfig('payout_account_review_sla_hours', '48'), 10) || 48));
    const enfriamientoHoras = Math.max(24, parseInt(await getConfig('retiro_cambio_cuenta_horas', '24'), 10) || 24);
    const evidenciaResult = await pool.query(
      `SELECT id, status, reason_code, requested_at, uploaded_at
         FROM payout_account_review_evidence
        WHERE provider_id = $1 AND status IN ('REQUESTED', 'UPLOADED')
        ORDER BY requested_at DESC LIMIT 1`,
      [req.user.id]
    );
    const evidencia = evidenciaResult.rows[0] || null;
    const revisionEstimadaAt = w.cuenta_estado_verificacion === 'PENDIENTE' && w.cuenta_cambio_solicitado_at
      ? new Date(new Date(w.cuenta_cambio_solicitado_at).getTime() + slaHoras * 60 * 60 * 1000)
      : null;

    res.json({
      configurada: true,
      tipo_cuenta: w.tipo_cuenta,
      banco: w.banco,
      numero_cuenta_enmascarado: enmascarada,
      tipo_cuenta_bancaria: w.tipo_cuenta_bancaria,
      cuenta_verificada: w.cuenta_verificada,
      estado_verificacion: w.cuenta_estado_verificacion || (w.cuenta_verificada ? 'APROBADA' : 'PENDIENTE'),
      cambio_solicitado_at: w.cuenta_cambio_solicitado_at,
      retiros_bloqueados_hasta: w.cuenta_retiros_bloqueados_hasta,
      revision_estimada_at: revisionEstimadaAt,
      revision_sla_horas: slaHoras,
      retiros_bloqueados_horas: enfriamientoHoras,
      cambio_cancelable: w.cuenta_cambio_cancelable === true,
      evidencia_titularidad: evidencia ? {
        id: evidencia.id,
        estado: evidencia.status,
        motivo: evidencia.reason_code,
        solicitada_at: evidencia.requested_at,
        cargada_at: evidencia.uploaded_at
      } : null
    });
  } catch (err) {
    console.error('Error al consultar cuenta bancaria:', err);
    res.status(500).json({ error: 'Error al consultar información bancaria.' });
  }
});

function normalizarDestinoCuenta(body = {}) {
  const tipoIngresado = String(body.tipo_cuenta || 'NEQUI').trim().toUpperCase();
  const tipo_cuenta = ['NEQUI', 'DAVIPLATA'].includes(tipoIngresado)
    ? tipoIngresado
    : ['AHORROS', 'CORRIENTE', 'BANCARIA'].includes(tipoIngresado) ? 'BANCARIA' : tipoIngresado;
  const banco = tipo_cuenta === 'NEQUI' ? 'Nequi'
    : tipo_cuenta === 'DAVIPLATA' ? 'Daviplata'
      : String(body.banco || 'Bancolombia').trim();
  return {
    tipo_cuenta,
    banco,
    numero_cuenta: String(body.numero_cuenta || '').trim(),
    tipo_cuenta_bancaria: ['NEQUI', 'DAVIPLATA'].includes(tipoIngresado)
      ? tipoIngresado
      : (tipoIngresado === 'CORRIENTE' ? 'CORRIENTE' : 'AHORROS'),
    titular_nombre: String(body.titular_nombre || '').trim(),
    titular_documento_tipo: String(body.titular_documento_tipo || '').trim().toUpperCase(),
    titular_documento_num: String(body.titular_documento_num || '').trim()
  };
}

const BANCOS_DESTINO_PERMITIDOS = new Map([
  ['bancolombia', 'Bancolombia'], ['banco de bogota', 'Banco de Bogotá'],
  ['davivienda', 'Davivienda'], ['bbva colombia', 'BBVA Colombia'],
  ['lulo bank', 'Lulo Bank'], ['rappipay', 'RappiPay'],
  ['banco de occidente', 'Banco de Occidente'], ['banco popular', 'Banco Popular'],
  ['scotiabank colpatria', 'Scotiabank Colpatria'],
]);

function validarDestinoCuenta(destino) {
  const tipo = destino.tipo_cuenta;
  if (!['NEQUI', 'DAVIPLATA', 'BANCARIA'].includes(tipo)) {
    return 'Selecciona Nequi, Daviplata o una cuenta bancaria.';
  }
  if (tipo === 'BANCARIA') {
    const claveBanco = destino.banco.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    if (!BANCOS_DESTINO_PERMITIDOS.has(claveBanco)) return 'Selecciona una entidad financiera disponible.';
    destino.banco = BANCOS_DESTINO_PERMITIDOS.get(claveBanco);
    if (!['AHORROS', 'CORRIENTE'].includes(destino.tipo_cuenta_bancaria)) {
      return 'Selecciona si la cuenta bancaria es de ahorros o corriente.';
    }
  }
  const cuenta = destino.numero_cuenta;
  if (tipo === 'NEQUI' || tipo === 'DAVIPLATA') {
    if (!/^3\d{9}$/.test(cuenta)) return 'El número de Nequi o Daviplata debe ser un celular colombiano de 10 dígitos.';
  } else if (!/^\d{6,30}$/.test(cuenta)) {
    return 'El número de cuenta debe tener entre 6 y 30 dígitos.';
  }
  if (!/^[\p{L}][\p{L}\p{M} .,'’-]{1,98}[\p{L}.]$/u.test(destino.titular_nombre)) {
    return 'Escribe el nombre legal completo del titular (entre 3 y 100 caracteres).';
  }
  if (!['CC', 'CE', 'NIT'].includes(destino.titular_documento_tipo)) {
    return 'Selecciona un tipo de documento válido.';
  }
  const documento = destino.titular_documento_num;
  if (!/^\d{5,15}$/.test(documento)) return 'Revisa el número de documento del titular.';
  return null;
}

function hashDestinoCuenta(destino, modalidad = 'CAMBIO') {
  return crypto.createHash('sha256').update(JSON.stringify({ ...destino, modalidad })).digest('hex');
}

function hashAutorizacionRetiro(monto, tipoOrigen, wallet) {
  return crypto.createHash('sha256').update(JSON.stringify({
    monto_centavos: aCentavos(monto), tipo_origen: tipoOrigen,
    banco: wallet.banco, numero_cuenta: wallet.numero_cuenta,
  })).digest('hex');
}

// Autoriza un retiro puntual con contraseña + código enviado al correo verificado.
router.post('/wallet/withdraw/authorization', authMiddleware, exigirCapacidad(CAPACIDADES.RETIRAR), otpLimiter, async (req, res) => {
  if (!await requirePrestador(req, res)) return;
  const password = String(req.body.current_password || '');
  const monto = Number(req.body.monto);
  const tipoOrigen = ['DEMANDA', 'SEMANAL', 'QUINCENA', 'MENSUAL']
    .includes(String(req.body.tipo_origen || '').toUpperCase())
    ? String(req.body.tipo_origen).toUpperCase() : 'DEMANDA';
  if (!password || !Number.isFinite(monto) || monto <= 0) {
    return res.status(400).json({ error: 'Contraseña actual y monto válido son obligatorios.' });
  }
  try {
    const contacto = await runAsSystem({ pool }, async (c) => {
      const result = await c.query('SELECT email, email_verificado, nombre, password_hash FROM usuarios WHERE id = $1', [req.user.id]);
      return result.rows[0] || null;
    });
    if (!contacto?.email || contacto.email_verificado !== true || !contacto.password_hash ||
        !await bcrypt.compare(password, contacto.password_hash)) {
      return res.status(403).json({ error: 'No se pudo verificar la identidad. Confirma contraseña y correo verificado.' });
    }
    if (!(process.env.BREVO_API_KEY || emailService.initEmailService())) {
      return res.status(503).json({ error: 'La autorización por correo no está disponible.' });
    }
    const walletRow = await runAsSystem({ pool }, async (c) => {
      const result = await c.query('SELECT * FROM provider_wallet WHERE provider_id = $1', [req.user.id]);
      return result.rows[0] || null;
    });
    const wallet = payoutData.decryptWallet(walletRow);
    if (!wallet?.numero_cuenta || !wallet.cuenta_verificada || wallet.cuenta_estado_verificacion !== 'APROBADA') {
      return res.status(403).json({ error: 'No existe una cuenta de retiro aprobada.' });
    }
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const codigoHash = await bcrypt.hash(code, 10);
    const payloadHash = hashAutorizacionRetiro(monto, tipoOrigen, wallet);
    const expira = new Date(Date.now() + 10 * 60 * 1000);
    const challenge = await runAsSystem({ pool }, async (c) => {
      await c.query('UPDATE payout_withdrawal_challenges SET usado_at = NOW() WHERE provider_id = $1 AND usado_at IS NULL', [req.user.id]);
      const inserted = await c.query(
        `INSERT INTO payout_withdrawal_challenges (provider_id, tenant_id, codigo_hash, payload_hash, expira_at, ip_generacion)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [req.user.id, req.user.tenant_id || null, codigoHash, payloadHash, expira, req.ip || null]
      );
      return inserted.rows[0];
    });
    try {
      const sent = await emailService.sendEmail({
        to: contacto.email, subject: 'Autoriza tu retiro · GlowApp',
        data: { html: `<p>Hola ${String(contacto.nombre || '').replace(/[&<>"']/g, '')},</p><p>Solicitaste un retiro por <strong>$${Math.round(monto).toLocaleString('es-CO')} COP</strong> a ${String(wallet.banco || '').replace(/[&<>"']/g, '')} terminada en <strong>${String(wallet.numero_cuenta).slice(-4)}</strong>.</p><p>Código: <strong>${code}</strong> (vence en 10 minutos).</p><p>Si no reconoces esta solicitud, congela los retiros desde GlowApp.</p>` }
      });
      if (sent?.devMode || sent?.simulated) throw new Error('Email simulado.');
    } catch (sendError) {
      await runAsSystem({ pool }, async (c) => c.query('UPDATE payout_withdrawal_challenges SET usado_at = NOW() WHERE id = $1', [challenge.id]));
      console.error('[PAYOUT] No se pudo enviar autorización:', sendError.message);
      return res.status(503).json({ error: 'No se pudo enviar el código; no se creó el retiro.' });
    }
    return res.json({ ok: true, authorization_id: challenge.id, expira_at: expira, cuenta_enmascarada: `****${String(wallet.numero_cuenta).slice(-4)}` });
  } catch (error) {
    console.error('[PAYOUT] Error creando autorización de retiro:', error.message);
    return res.status(500).json({ error: 'No se pudo iniciar la autorización del retiro.' });
  }
});

// Segundo factor por correo previamente verificado. El código nunca se devuelve
// al dispositivo y el reto solo autoriza el destino exacto que fue solicitado.
router.post('/wallet/bank-account/authorization', authMiddleware, otpLimiter, async (req, res) => {
  if (!await requirePrestador(req, res)) return;
  const currentPassword = String(req.body.current_password || '');
  const googleIdToken = String(req.body.google_id_token || '');

  const destino = normalizarDestinoCuenta(req.body);
  const errorDestino = validarDestinoCuenta(destino);
  if (errorDestino) return res.status(400).json({ error: errorDestino });

  try {
    const contacto = await runAsSystem({ pool }, async (c) => {
      const result = await c.query(
        'SELECT email, email_verificado, nombre, password_hash, auth_provider, provider_id FROM usuarios WHERE id = $1',
        [req.user.id]
      );
      return result.rows[0] || null;
    });
    if (!contacto?.email) {
      return res.status(403).json({ error: 'La cuenta no tiene un correo asociado.' });
    }

    // El primer destino se autoriza con el correo verificado: los usuarios
    // federados no tienen necesariamente una contraseña local de GlowApp.
    const wallet = await runAsSystem({ pool }, async (c) => {
      await c.query(
        'INSERT INTO provider_wallet (provider_id) VALUES ($1) ON CONFLICT (provider_id) DO NOTHING',
        [req.user.id]
      );
      const result = await c.query(
        'SELECT numero_cuenta FROM provider_wallet WHERE provider_id = $1',
        [req.user.id]
      );
      return result.rows[0] || null;
    });
    const primeraCuenta = !wallet?.numero_cuenta;
    const emailPruebaPermitido = String(process.env.PAYOUT_OTP_TEST_EMAIL || '').trim().toLowerCase();
    const modoOtpPrueba = process.env.RAILWAY_ENVIRONMENT_NAME === 'staging' &&
      process.env.PAYOUT_OTP_TEST_MODE === 'true' &&
      primeraCuenta &&
      emailPruebaPermitido.length > 0 &&
      String(contacto.email).trim().toLowerCase() === emailPruebaPermitido;
    if (!primeraCuenta && contacto.password_hash) {
      if (!currentPassword || !await bcrypt.compare(currentPassword, contacto.password_hash)) {
        return res.status(403).json({ error: 'La contraseña actual no es válida. No se inició el cambio de cuenta.' });
      }
    } else if (!primeraCuenta && String(contacto.auth_provider || '').toUpperCase() === 'GOOGLE') {
      if (!googleIdToken) {
        return res.status(403).json({ error: 'Confirma tu identidad con Google para cambiar el destino de retiro.', requiere_google: true });
      }
      const activeClientId = (process.env.GOOGLE_CLIENT_ID || '374223351186-0fukntsog02r0p1tofd2aju3c7lsr86j.apps.googleusercontent.com').trim();
      const oauthClient = new OAuth2Client(activeClientId);
      let googlePayload;
      try {
        const ticket = await oauthClient.verifyIdToken({
          idToken: googleIdToken,
          audience: [
            activeClientId,
            '374223351186-0fukntsog02r0p1tofd2aju3c7lsr86j.apps.googleusercontent.com',
            '374223351186-hi0m9k8778gfkg69spbkimgk73t51g5q.apps.googleusercontent.com',
            '466897054371-qaec2ipcc0pea91obs0ejcb9tene7kma.apps.googleusercontent.com'
          ].filter(Boolean)
        });
        googlePayload = ticket.getPayload();
      } catch (_) {
        return res.status(403).json({ error: 'No se pudo confirmar tu sesión de Google. Inténtalo de nuevo.' });
      }
      const emitidoAt = Number(googlePayload?.iat || 0) * 1000;
      const identidadCoincide = String(googlePayload?.email || '').toLowerCase() === String(contacto.email).toLowerCase() &&
        googlePayload?.email_verified === true &&
        (!contacto.provider_id || String(googlePayload?.sub || '') === String(contacto.provider_id));
      if (!identidadCoincide || !emitidoAt || Date.now() - emitidoAt > 5 * 60 * 1000) {
        return res.status(403).json({ error: 'La confirmación de Google venció o no corresponde a esta cuenta.' });
      }
    } else if (!primeraCuenta) {
      return res.status(403).json({ error: 'La cuenta no tiene un método de verificación disponible. Contacta a soporte.' });
    }

    if (!modoOtpPrueba) {
      const transporteReal = Boolean(process.env.BREVO_API_KEY || emailService.initEmailService());
      if (!transporteReal) {
        return res.status(503).json({ error: 'La verificación reforzada no está disponible. No se modificó la cuenta.' });
      }
    }

    const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const codigoHash = await bcrypt.hash(codigo, 10);
    const expiraAt = new Date(Date.now() + 10 * 60 * 1000);
    const destinoHash = hashDestinoCuenta(destino, primeraCuenta ? 'PRIMERA_CUENTA' : 'CAMBIO');
    const challenge = await runAsSystem({ pool }, async (c) => {
      await c.query(
        `UPDATE payout_account_change_challenges SET usado_at = NOW()
         WHERE provider_id = $1 AND usado_at IS NULL`,
        [req.user.id]
      );
      const result = await c.query(
        `INSERT INTO payout_account_change_challenges
           (provider_id, tenant_id, codigo_hash, destino_hash, expira_at, ip_generacion)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [req.user.id, req.user.tenant_id || null, codigoHash, destinoHash, expiraAt, req.ip || null]
      );
      return result.rows[0];
    });

    if (modoOtpPrueba) {
      console.info(`[PAYOUT ACCOUNT TEST] Challenge de cuenta creado para allowlist; challenge=${challenge.id}`);
    } else {
      try {
        const enviado = await emailService.sendEmail({
          to: contacto.email,
          subject: 'Autoriza el cambio de cuenta de retiro · GlowApp',
          data: {
            html: `<p>Hola ${String(contacto.nombre || '').replace(/[&<>"']/g, '')},</p>
              <p>Solicitaste cambiar la cuenta de retiro por una terminada en <strong>${destino.numero_cuenta.slice(-4)}</strong>.</p>
              <p>Tu código de autorización es <strong style="font-size:24px;letter-spacing:5px">${codigo}</strong>.</p>
              <p>Vence en 10 minutos. Si no reconoces la solicitud, ignora este correo y contacta a soporte.</p>`
          }
        });
        if (enviado?.devMode || enviado?.simulated) throw new Error('El proveedor no confirmó el envío del código.');
      } catch (sendError) {
        await runAsSystem({ pool }, async (c) => c.query(
          'UPDATE payout_account_change_challenges SET usado_at = NOW() WHERE id = $1', [challenge.id]
        ));
        console.error('[PAYOUT ACCOUNT] No se pudo enviar OTP:', sendError.message);
        return res.status(503).json({ error: 'No se pudo enviar el código. No se modificó la cuenta.' });
      }
    }

    const [local, dominio] = String(contacto.email).split('@');
    const correoEnmascarado = `${local.slice(0, 1)}${'•'.repeat(Math.max(3, Math.min(local.length - 1, 6)))}${local.length > 1 ? local.slice(-1) : ''}@${dominio}`;
    return res.json({
      ok: true,
      challenge_id: challenge.id,
      expira_at: expiraAt,
      correo_enmascarado: correoEnmascarado,
      modalidad: primeraCuenta ? 'PRIMERA_CUENTA' : 'CAMBIO',
      correo_por_confirmar: contacto.email_verificado !== true,
      mensaje: modoOtpPrueba
        ? 'Código de prueba generado para esta cuenta de staging.'
        : contacto.email_verificado === true
          ? 'Enviamos un código al correo de tu cuenta.'
          : 'Enviamos un código para confirmar el correo de tu cuenta y autorizar este destino de retiro.',
      ...(modoOtpPrueba && { otp_dev: codigo, modo_prueba: true })
    });
  } catch (err) {
    console.error('[PAYOUT ACCOUNT] Error creando autorización:', err.message);
    return res.status(500).json({ error: 'No se pudo iniciar la autorización del cambio.' });
  }
});

// ─── WALLET — REGISTRAR / ACTUALIZAR CUENTA BANCARIA ───────────────────────

const handleSaveBankAccount = async (req, res) => {
  if (!await requirePrestador(req, res)) return;

  const {
    numero_cuenta,
    titular_nombre,
    titular_documento_tipo,
    titular_documento_num,
    flow_session_id
  } = req.body;
  const { authorization_id, authorization_code } = req.body;

  const destinoNormalizado = normalizarDestinoCuenta(req.body);
  const errorDestino = validarDestinoCuenta(destinoNormalizado);
  if (errorDestino) return res.status(400).json({ error: errorDestino });
  const bancoNormalizado = destinoNormalizado.banco;
  const tipoCuentaFinal = destinoNormalizado.tipo_cuenta;
  const tipoBancariaFinal = destinoNormalizado.tipo_cuenta_bancaria;
  if (flow_session_id && !/^[0-9a-f-]{36}$/i.test(String(flow_session_id))) {
    return res.status(400).json({ error: 'Sesión de flujo inválida.' });
  }
  if (!authorization_id || !/^\d{6}$/.test(String(authorization_code || ''))) {
    return res.status(403).json({ error: 'Necesitas un código de seguridad vigente para cambiar la cuenta.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (req.user.tenant_id) {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(req.user.tenant_id)]);
    }
    await client.query("SELECT set_config('app.user_id', $1, true)", [String(req.user.id)]);
    if (flow_session_id) {
      const flow = await client.query(
        `SELECT id FROM payout_account_flow_sessions
          WHERE id = $1 AND provider_id = $2 AND status = 'OPEN' FOR UPDATE`,
        [flow_session_id, req.user.id]
      );
      if (!flow.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'La sesión del formulario venció. Cierra y vuelve a abrir el registro de cuenta.' });
      }
    }

    // Bloquea el estado del destino mientras se consume el reto. Así un reto
    // creado para la primera inscripción no puede reutilizarse como cambio.
    await client.query(
      'INSERT INTO provider_wallet (provider_id) VALUES ($1) ON CONFLICT (provider_id) DO NOTHING',
      [req.user.id]
    );
    const estadoCuentaRes = await client.query(
      'SELECT numero_cuenta FROM provider_wallet WHERE provider_id = $1 FOR UPDATE',
      [req.user.id]
    );
    const primeraCuenta = !estadoCuentaRes.rows[0]?.numero_cuenta;

    const retoRes = await client.query(
      `SELECT id, codigo_hash, destino_hash, expira_at, intentos_fallidos, usado_at
         FROM payout_account_change_challenges
        WHERE id = $1 AND provider_id = $2 AND tenant_id IS NOT DISTINCT FROM $3
        FOR UPDATE`,
      [authorization_id, req.user.id, req.user.tenant_id || null]
    );
    const reto = retoRes.rows[0];
    if (!reto || reto.usado_at || new Date(reto.expira_at) <= new Date() || reto.intentos_fallidos >= 5) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'El código venció o ya fue utilizado. Solicita uno nuevo.' });
    }
    const codigoValido = await bcrypt.compare(String(authorization_code), reto.codigo_hash);
    const destinoValido = crypto.timingSafeEqual(
      Buffer.from(reto.destino_hash, 'hex'),
      Buffer.from(hashDestinoCuenta(destinoNormalizado, primeraCuenta ? 'PRIMERA_CUENTA' : 'CAMBIO'), 'hex')
    );
    if (!codigoValido || !destinoValido) {
      await client.query(
        `UPDATE payout_account_change_challenges
            SET intentos_fallidos = intentos_fallidos + 1,
                usado_at = CASE WHEN intentos_fallidos + 1 >= 5 THEN NOW() ELSE usado_at END
          WHERE id = $1`, [authorization_id]
      );
      await client.query('COMMIT');
      return res.status(403).json({ error: destinoValido ? 'Código incorrecto.' : 'El código no corresponde a estos datos de cuenta.' });
    }
    await client.query('UPDATE payout_account_change_challenges SET usado_at = NOW() WHERE id = $1', [authorization_id]);

    // El OTP se envió al correo registrado y acaba de validarse. Si aún estaba
    // pendiente, esta prueba de posesión completa también la verificación del correo.
    await client.query(
      'UPDATE usuarios SET email_verificado = TRUE WHERE id = $1 AND email_verificado = FALSE',
      [req.user.id]
    );

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
    const datosAntes = payoutData.decryptWallet(datosAntesRes.rows[0]);
    const enfriamientoHoras = Math.max(24, parseInt(await getConfig('retiro_cambio_cuenta_horas', '24'), 10) || 24);
    const slaRevisionHoras = Math.max(1, Math.min(720, parseInt(await getConfig('payout_account_review_sla_hours', '48'), 10) || 48));

    // Una modificación del destino invalida la aprobación anterior. La cuenta
    // solo podrá aprobarse mediante el flujo administrativo/verificador.
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
           cuenta_anterior_tipo_cuenta = CASE WHEN provider_wallet.cuenta_verificada THEN provider_wallet.tipo_cuenta ELSE provider_wallet.cuenta_anterior_tipo_cuenta END,
           cuenta_anterior_banco = CASE WHEN provider_wallet.cuenta_verificada THEN provider_wallet.banco ELSE provider_wallet.cuenta_anterior_banco END,
           cuenta_anterior_numero = CASE WHEN provider_wallet.cuenta_verificada THEN provider_wallet.numero_cuenta ELSE provider_wallet.cuenta_anterior_numero END,
           cuenta_anterior_tipo_bancaria = CASE WHEN provider_wallet.cuenta_verificada THEN provider_wallet.tipo_cuenta_bancaria ELSE provider_wallet.cuenta_anterior_tipo_bancaria END,
           cuenta_anterior_titular_nombre = CASE WHEN provider_wallet.cuenta_verificada THEN provider_wallet.titular_nombre ELSE provider_wallet.cuenta_anterior_titular_nombre END,
           cuenta_anterior_documento_tipo = CASE WHEN provider_wallet.cuenta_verificada THEN provider_wallet.titular_documento_tipo ELSE provider_wallet.cuenta_anterior_documento_tipo END,
           cuenta_anterior_documento_num = CASE WHEN provider_wallet.cuenta_verificada THEN provider_wallet.titular_documento_num ELSE provider_wallet.cuenta_anterior_documento_num END,
           cuenta_anterior_verificada = CASE WHEN provider_wallet.cuenta_verificada THEN TRUE ELSE provider_wallet.cuenta_anterior_verificada END,
           cuenta_anterior_verificada_at = CASE WHEN provider_wallet.cuenta_verificada THEN provider_wallet.cuenta_verificada_at ELSE provider_wallet.cuenta_anterior_verificada_at END,
           cuenta_anterior_verificada_por = CASE WHEN provider_wallet.cuenta_verificada THEN provider_wallet.cuenta_verificada_por ELSE provider_wallet.cuenta_anterior_verificada_por END,
           cuenta_cambio_solicitado_at = NOW(),
           cuenta_retiros_bloqueados_hasta = NOW() + ($9::int * INTERVAL '1 hour'),
           cuenta_verificada = FALSE,
           cuenta_estado_verificacion = 'PENDIENTE',
           cuenta_flow_session_id = COALESCE($10, cuenta_flow_session_id),
           cuenta_verificada_at = NULL,
           cuenta_verificada_por = NULL,
           updated_at = NOW()
       WHERE provider_id = $1
       RETURNING tipo_cuenta, banco, numero_cuenta, tipo_cuenta_bancaria,
                 titular_nombre, titular_documento_tipo, titular_documento_num,
                 cuenta_verificada`,
      [
        req.user.id,
        tipoCuentaFinal,
        bancoNormalizado,
        payoutData.encrypt(numero_cuenta.trim()),
        tipoBancariaFinal,
        titular_nombre ? payoutData.encrypt(String(titular_nombre).trim()) : null,
        titular_documento_tipo ? String(titular_documento_tipo).trim().toUpperCase() : null,
        titular_documento_num ? payoutData.encrypt(String(titular_documento_num).trim()) : null,
        enfriamientoHoras,
        flow_session_id || null
      ]
    );

    if (flow_session_id) {
      await client.query(
        `UPDATE payout_account_flow_sessions
            SET status = 'SUBMITTED', submitted_at = NOW(), closed_at = NOW()
          WHERE id = $1 AND provider_id = $2 AND status = 'OPEN'`,
        [flow_session_id, req.user.id]
      );
    }
    await client.query(
      `UPDATE payout_account_review_evidence
          SET status = 'EXPIRED', file_ciphertext = NULL, file_mime_type = NULL,
              file_bytes = NULL, purge_at = COALESCE(purge_at, NOW())
        WHERE provider_id = $1 AND status IN ('REQUESTED', 'UPLOADED')`,
      [req.user.id]
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
        titular_registrado: Boolean(titular_nombre),
        doc_tipo: titular_documento_tipo || null,
        doc_num: titular_documento_num ? `****${titular_documento_num.slice(-4)}` : null
      },
      ip: req.ip
    });

    await client.query('COMMIT');

    await notificarEventoSeguridadRetiros(req.user.id, {
      subject: 'Cambio solicitado en tu cuenta de retiros · GlowApp',
      title: 'Cambio de cuenta de retiro',
      body: `Se solicitó cambiar tu cuenta de retiros. El nuevo destino está pendiente de validación y los retiros permanecen bloqueados por al menos ${enfriamientoHoras} horas.`,
      tipo: 'PAYOUT_ACCOUNT_CHANGED'
    });

    const enmascarada = numero_cuenta.trim().length > 4
      ? `****${numero_cuenta.trim().slice(-4)}`
      : '****';
    const revisionEstimadaAt = new Date(Date.now() + slaRevisionHoras * 60 * 60 * 1000);
    const retirosBloqueadosHasta = new Date(Date.now() + enfriamientoHoras * 60 * 60 * 1000);

    res.json({
      ok: true,
      mensaje: `Cuenta registrada. La revisión tiene un plazo objetivo de hasta ${slaRevisionHoras} horas.`,
      revision_estimada_at: revisionEstimadaAt,
      revision_sla_horas: slaRevisionHoras,
      retiros_bloqueados_hasta: retirosBloqueadosHasta,
      retiros_bloqueados_horas: enfriamientoHoras,
      cuenta: {
        tipo_cuenta: cuentaActualizada.tipo_cuenta,
        banco: cuentaActualizada.banco,
        numero_cuenta_enmascarado: enmascarada,
        tipo_cuenta_bancaria: cuentaActualizada.tipo_cuenta_bancaria,
        cuenta_verificada: false,
        estado_verificacion: 'PENDIENTE'
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

router.post('/wallet/bank-account/cancel-change', authMiddleware, async (req, res) => {
  if (!await requirePrestador(req, res)) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT banco, numero_cuenta, cuenta_estado_verificacion, cuenta_anterior_verificada
         FROM provider_wallet WHERE provider_id = $1 FOR UPDATE`, [req.user.id]
    );
    if (!current.rows.length || current.rows[0].cuenta_estado_verificacion !== 'PENDIENTE') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'No hay un cambio de cuenta pendiente para cancelar.' });
    }
    const antes = payoutData.decryptWallet(current.rows[0]);
    await client.query(
      `UPDATE provider_wallet SET
         tipo_cuenta = CASE WHEN cuenta_anterior_verificada THEN cuenta_anterior_tipo_cuenta ELSE NULL END,
         banco = CASE WHEN cuenta_anterior_verificada THEN cuenta_anterior_banco ELSE NULL END,
         numero_cuenta = CASE WHEN cuenta_anterior_verificada THEN cuenta_anterior_numero ELSE NULL END,
         tipo_cuenta_bancaria = CASE WHEN cuenta_anterior_verificada THEN cuenta_anterior_tipo_bancaria ELSE NULL END,
         titular_nombre = CASE WHEN cuenta_anterior_verificada THEN cuenta_anterior_titular_nombre ELSE NULL END,
         titular_documento_tipo = CASE WHEN cuenta_anterior_verificada THEN cuenta_anterior_documento_tipo ELSE NULL END,
         titular_documento_num = CASE WHEN cuenta_anterior_verificada THEN cuenta_anterior_documento_num ELSE NULL END,
         cuenta_verificada = cuenta_anterior_verificada,
         cuenta_estado_verificacion = CASE WHEN cuenta_anterior_verificada THEN 'APROBADA' ELSE 'PENDIENTE' END,
         cuenta_verificada_at = CASE WHEN cuenta_anterior_verificada THEN cuenta_anterior_verificada_at ELSE NULL END,
         cuenta_verificada_por = CASE WHEN cuenta_anterior_verificada THEN cuenta_anterior_verificada_por ELSE NULL END,
         cuenta_cambio_solicitado_at = NULL, cuenta_retiros_bloqueados_hasta = NULL,
         cuenta_anterior_tipo_cuenta = NULL, cuenta_anterior_banco = NULL,
         cuenta_anterior_numero = NULL, cuenta_anterior_tipo_bancaria = NULL,
         cuenta_anterior_titular_nombre = NULL, cuenta_anterior_documento_tipo = NULL,
         cuenta_anterior_documento_num = NULL, cuenta_anterior_verificada = FALSE,
         cuenta_anterior_verificada_at = NULL, cuenta_anterior_verificada_por = NULL,
         updated_at = NOW()
       WHERE provider_id = $1
       RETURNING cuenta_anterior_verificada`, [req.user.id]
    );
    const restoredPrevious = antes.cuenta_anterior_verificada === true;
    await auditLog(client, {
      actorId: req.user.id, accion: 'CAMBIO_CUENTA_RETIRO_CANCELADO', tabla: 'provider_wallet',
      registroId: req.user.id,
      datosAntes: { banco: antes.banco, cuenta: antes.numero_cuenta ? `****${antes.numero_cuenta.slice(-4)}` : null },
      datosDespues: { destino_anterior_restaurado: restoredPrevious }, ip: req.ip
    });
    await client.query('COMMIT');
    await notificarEventoSeguridadRetiros(req.user.id, {
      subject: 'Cambio de cuenta de retiro cancelado · GlowApp',
      title: 'Cambio de cuenta cancelado',
      body: restoredPrevious ? 'Se canceló el cambio solicitado y se restauró la cuenta aprobada anterior.' : 'Se canceló el cambio solicitado y se eliminó el destino pendiente.',
      tipo: 'PAYOUT_ACCOUNT_CHANGE_CANCELLED'
    });
    return res.json({ ok: true, cuenta_anterior_restaurada: restoredPrevious, mensaje: 'Cambio cancelado.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PAYOUT ACCOUNT] Error cancelando cambio:', err.message);
    return res.status(500).json({ error: 'No se pudo cancelar el cambio de cuenta.' });
  } finally {
    client.release();
  }
});

router.post('/wallet/freeze-withdrawals', authMiddleware, async (req, res) => {
  if (!await requirePrestador(req, res)) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO provider_wallet (provider_id) VALUES ($1) ON CONFLICT (provider_id) DO NOTHING', [req.user.id]);
    const result = await client.query(
      `UPDATE provider_wallet SET retiros_pausados = TRUE, updated_at = NOW()
       WHERE provider_id = $1 RETURNING retiros_pausados`, [req.user.id]
    );
    await auditLog(client, {
      actorId: req.user.id, accion: 'RETIROS_CONGELADOS_POR_PRESTADOR', tabla: 'provider_wallet',
      registroId: req.user.id, datosDespues: { retiros_pausados: true }, ip: req.ip
    });
    await client.query('COMMIT');
    await notificarEventoSeguridadRetiros(req.user.id, {
      subject: 'Retiros congelados · GlowApp', title: 'Retiros congelados',
      body: 'Los retiros de tu cuenta quedaron congelados. Contacta a soporte para reactivarlos después de verificar tu identidad.',
      tipo: 'PAYOUTS_FROZEN'
    });
    return res.json({ ok: true, retiros_pausados: result.rows[0].retiros_pausados });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PAYOUT SECURITY] Error congelando retiros:', err.message);
    return res.status(500).json({ error: 'No se pudieron congelar los retiros.' });
  } finally {
    client.release();
  }
});

// ─── RETIRO — SOLICITAR ───────────────────────────────────────────────────────

router.post(
  '/wallet/withdraw',
  authMiddleware,
  exigirCapacidad(CAPACIDADES.RETIRAR),
  async (req, res) => {
  if (!await requirePrestador(req, res)) return;
  const { authorization_id, authorization_code } = req.body;
  if (!authorization_id || !/^\d{6}$/.test(String(authorization_code || ''))) {
    return res.status(403).json({ error: 'El retiro requiere una autorización vigente enviada al correo.' });
  }

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
    await client.query("SELECT set_config('app.user_id', $1, true)", [String(req.user.id)]);

    const { rows } = await client.query(
      'SELECT * FROM provider_wallet WHERE provider_id = $1 FOR UPDATE',
      [req.user.id]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Wallet no encontrado.' });
    }

    const wallet = payoutData.decryptWallet(rows[0]);
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

    if (wallet.cuenta_retiros_bloqueados_hasta &&
        new Date(wallet.cuenta_retiros_bloqueados_hasta).getTime() > Date.now()) {
      await client.query('ROLLBACK');
      return res.status(423).json({
        error: 'Cambio de cuenta en periodo de protección. No se realizó ningún débito.',
        retiros_bloqueados_hasta: wallet.cuenta_retiros_bloqueados_hasta
      });
    }

    if (!wallet.cuenta_verificada || wallet.cuenta_estado_verificacion !== 'APROBADA') {
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

    const authResult = await client.query(
      `SELECT id, codigo_hash, payload_hash, expira_at, intentos_fallidos, usado_at
         FROM payout_withdrawal_challenges
        WHERE id = $1 AND provider_id = $2 AND tenant_id IS NOT DISTINCT FROM $3
        FOR UPDATE`,
      [authorization_id, req.user.id, req.user.tenant_id || null]
    );
    const authorization = authResult.rows[0];
    if (!authorization || authorization.usado_at || new Date(authorization.expira_at) <= new Date() || authorization.intentos_fallidos >= 5) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'La autorización venció o ya fue utilizada. Solicita otra.' });
    }
    const codeMatches = await bcrypt.compare(String(authorization_code), authorization.codigo_hash);
    const payloadMatches = crypto.timingSafeEqual(
      Buffer.from(authorization.payload_hash, 'hex'),
      Buffer.from(hashAutorizacionRetiro(montoSolicitado, tipoOrigen, wallet), 'hex')
    );
    if (!codeMatches || !payloadMatches) {
      await client.query(
        `UPDATE payout_withdrawal_challenges SET intentos_fallidos = intentos_fallidos + 1,
          usado_at = CASE WHEN intentos_fallidos + 1 >= 5 THEN NOW() ELSE usado_at END WHERE id = $1`,
        [authorization_id]
      );
      await client.query('COMMIT');
      return res.status(403).json({ error: payloadMatches ? 'Código de seguridad incorrecto.' : 'La autorización no corresponde al monto, ciclo o destino actual.' });
    }
    await client.query('UPDATE payout_withdrawal_challenges SET usado_at = NOW() WHERE id = $1', [authorization_id]);

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
        payoutData.encrypt(wallet.numero_cuenta), wallet.banco,
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
          cuenta: `****${String(wallet.numero_cuenta).slice(-4)}`,
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
      cuenta: `${wallet.banco} ****${String(wallet.numero_cuenta || '').slice(-4)}`,
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

const abrirDisputaServicio = async (req, res) => {
  const { booking_id, tipo, descripcion, evidencia_urls } = req.body;
  const tiposDisputaPermitidos = [
    'CALIDAD_SERVICIO', 'OTP_BLOQUEADO', 'CARGO_NO_RECONOCIDO', 'FRAUDE', 'FALLA_TECNICA',
  ];

  if (!booking_id || !tiposDisputaPermitidos.includes(tipo) || typeof descripcion !== 'string' || descripcion.trim().length < 15 || descripcion.trim().length > 10000) {
    return res.status(400).json({ error: 'Cita, motivo y descripción (15 a 10.000 caracteres) son obligatorios.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_system');

    const { rows } = await client.query(
      `SELECT b.*, u_c.rol as rol_cliente, u_p.rol as rol_prestador
       FROM bookings b
       JOIN usuarios u_c ON b.client_id = u_c.id
       JOIN usuarios u_p ON b.provider_id = u_p.id
       WHERE b.id = $1 AND (b.client_id::text = $2::text OR b.provider_id::text = $2::text)
       FOR UPDATE OF b`,
      [booking_id, req.user.id]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Reserva no encontrada.' });
    }

    const booking = rows[0];
    if (String(booking.estado).toUpperCase() !== 'COMPLETADA') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Solo se pueden disputar citas completadas. Los casos de inasistencia requieren un flujo financiero distinto.' });
    }
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

    const validacionEvidencias = validarEvidencias(evidencia_urls);
    if (!validacionEvidencias.ok) {
      await client.query('ROLLBACK');
      return res.status(validacionEvidencias.status).json({ error: 'EVIDENCIA_INVALIDA', mensaje: validacionEvidencias.message });
    }
    const evidencias = validacionEvidencias.evidence;

    const slaDias = parseInt(await getConfig('disputa_sla_dias', '5'), 10);

    const disputaResult = await client.query(
      `INSERT INTO disputas
         (booking_id, iniciado_por, tipo_actor, tipo, descripcion, evidencia_urls, monto_disputado, sla_limite_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + ($8 || ' days')::interval)
       RETURNING *`,
      [booking_id, req.user.id, rolActor, tipo, String(descripcion || '').trim(), evidencias, booking.valor_bruto, slaDias]
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

    const otherPartyId = String(booking.client_id) === String(req.user.id)
      ? booking.provider_id : booking.client_id;
    const notification = await notifyDisputeUsers({
      userIds: [otherPartyId], disputeId: disputaResult.rows[0].id, bookingId,
      actorId: req.user.id, message: 'Se abrió un caso relacionado con esta cita. Revisa el expediente y agrega tu versión.',
    });
    if (process.env.SUPPORT_INBOX_EMAIL) {
      try {
        await emailService.sendEmail({
          to: process.env.SUPPORT_INBOX_EMAIL,
          subject: `Nueva disputa de servicio ${disputaResult.rows[0].id}`,
          data: { text: `Nueva disputa de servicio\nCaso: ${disputaResult.rows[0].id}\nCita: ${booking_id}\nMotivo: ${tipo}\nIngresa al panel administrativo para revisar el expediente.` },
        });
      } catch (mailError) {
        console.error('[disputas] aviso a soporte falló:', mailError.message);
      }
    }

    res.status(201).json({
      ok: true,
      success: true,
      mensaje: `Disputa registrada. El pago queda congelado y se resuelve en máximo ${slaDias} días.`,
      notification,
      disputa: disputaResult.rows[0]
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al abrir disputa:', err);
    res.status(500).json({ error: 'Error al registrar la disputa.' });
  } finally {
    client.release();
  }
};
router.post('/disputes', authMiddleware, abrirDisputaServicio);
// Compatibilidad con versiones anteriores de las apps: el alias usa exactamente
// el mismo flujo financiero y sus validaciones.
router.post('/disputas', authMiddleware, abrirDisputaServicio);

// El expediente de disputa es compartido entre cliente y prestador. Todas las
// consultas cruzadas se ejecutan con el rol de sistema y luego se autorizan por
// participación explícita en la cita.
const listarMisDisputas = async (req, res) => {
  try {
    const result = await runAsSystem({ pool }, (client) => client.query(
      `SELECT d.*, b.scheduled_at AS booking_fecha, b.client_id, b.provider_id,
          s.name AS servicio_nombre, b.booking_number
       FROM disputas d JOIN bookings b ON b.id = d.booking_id
       LEFT JOIN services s ON s.id = b.service_id
       WHERE b.client_id::text = $1::text OR b.provider_id::text = $1::text
       ORDER BY d.creado_at DESC`, [req.user.id]));
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('[disputas] error listando expedientes:', error.message);
    return res.status(500).json({ error: 'No se pudieron cargar las disputas.' });
  }
};
router.get('/disputes/my-disputes', authMiddleware, listarMisDisputas);
router.get('/disputas/my-disputes', authMiddleware, listarMisDisputas);

const detalleDisputa = async (req, res) => {
  try {
    const result = await runAsSystem({ pool }, async (client) => {
      const caso = await client.query(
        `SELECT d.*, b.client_id, b.provider_id, b.scheduled_at AS booking_fecha,
            b.booking_number, s.name AS servicio_nombre
         FROM disputas d JOIN bookings b ON b.id = d.booking_id
         LEFT JOIN services s ON s.id = b.service_id WHERE d.id = $1`, [req.params.id]);
      if (!caso.rows.length) return { caso: null, mensajes: [] };
      const mensajes = await client.query(
        `SELECT m.id, m.remitente_id, m.audiencia, m.mensaje, m.evidencia_urls, m.creado_at,
            u.nombre AS remitente_nombre
         FROM disputa_mensajes m LEFT JOIN usuarios u ON u.id = m.remitente_id
         WHERE m.disputa_id = $1 AND m.audiencia = 'PARTES'
         ORDER BY m.creado_at, m.id`, [req.params.id]);
      return { caso: caso.rows[0], mensajes: mensajes.rows };
    });
    if (!result.caso) return res.status(404).json({ error: 'Disputa no encontrada.' });
    const id = String(req.user.id);
    if (String(result.caso.client_id) !== id && String(result.caso.provider_id) !== id) {
      return res.status(403).json({ error: 'No autorizado para consultar este expediente.' });
    }
    return res.json({ success: true, data: { ...result.caso, mensajes: result.mensajes } });
  } catch (error) {
    console.error('[disputas] error consultando expediente:', error.message);
    return res.status(500).json({ error: 'No se pudo cargar el expediente.' });
  }
};
router.get('/disputes/:id', authMiddleware, detalleDisputa);
router.get('/disputas/:id', authMiddleware, detalleDisputa);

const responderDisputa = async (req, res) => {
  const mensaje = typeof req.body?.mensaje === 'string' ? req.body.mensaje.trim() : '';
  if (!mensaje || mensaje.length > 4000) return res.status(400).json({ error: 'Escribe un mensaje de 1 a 4.000 caracteres.' });
  const validacionEvidencias = validarEvidencias(req.body?.evidencia_urls);
  if (!validacionEvidencias.ok) return res.status(validacionEvidencias.status).json({ error: 'EVIDENCIA_INVALIDA', mensaje: validacionEvidencias.message });
  try {
    const result = await runAsSystem({ pool }, async (client) => {
      const caso = await client.query(
        `SELECT d.id, d.estado, b.id AS booking_id, b.client_id, b.provider_id,
            COALESCE(d.tenant_id, b.tenant_id, u_p.tenant_id, u_c.tenant_id) AS tenant_id
         FROM disputas d JOIN bookings b ON b.id = d.booking_id
         LEFT JOIN usuarios u_p ON u_p.id = b.provider_id
         LEFT JOIN usuarios u_c ON u_c.id = b.client_id
         WHERE d.id = $1`, [req.params.id]);
      if (!caso.rows.length) return { error: 'NOT_FOUND' };
      const row = caso.rows[0];
      const id = String(req.user.id);
      if (String(row.client_id) !== id && String(row.provider_id) !== id) return { error: 'FORBIDDEN' };
      if (['RESUELTA', 'CERRADA'].includes(String(row.estado))) return { error: 'CLOSED' };
      const tenantId = row.tenant_id || req.user.tenant_id;
      if (!tenantId) return { error: 'TENANT_MISSING' };
      const inserted = await client.query(
        `INSERT INTO disputa_mensajes (disputa_id, remitente_id, audiencia, mensaje, evidencia_urls, tenant_id)
         VALUES ($1, $2, 'PARTES', $3, $4, $5)
         RETURNING id, disputa_id, remitente_id, audiencia, mensaje, evidencia_urls, creado_at`,
        [req.params.id, req.user.id, mensaje, validacionEvidencias.evidence, tenantId]);
      await client.query('UPDATE disputas SET actualizado_at = NOW() WHERE id = $1', [req.params.id]);
      const recipientId = String(row.client_id) === id ? row.provider_id : row.client_id;
      return { message: inserted.rows[0], recipientId, bookingId: row.booking_id };
    });
    if (result.error === 'NOT_FOUND') return res.status(404).json({ error: 'Disputa no encontrada.' });
    if (result.error === 'FORBIDDEN') return res.status(403).json({ error: 'No autorizado para responder en este expediente.' });
    if (result.error === 'CLOSED') return res.status(409).json({ error: 'El caso está cerrado y no admite nuevas respuestas.' });
    if (result.error) return res.status(409).json({ error: 'No se pudo resolver el tenant del expediente.' });
    const notification = await notifyDisputeUsers({
      userIds: [result.recipientId], disputeId: req.params.id, bookingId: result.bookingId,
      actorId: req.user.id, message: 'La otra parte agregó una respuesta al expediente.',
    });
    return res.status(201).json({ success: true, data: result.message, notification });
  } catch (error) {
    console.error('[disputas] error guardando mensaje:', error.message);
    return res.status(500).json({ error: 'No se pudo guardar el mensaje.' });
  }
};
router.post('/disputes/:id/messages', authMiddleware, responderDisputa);
router.post('/disputas/:id/messages', authMiddleware, responderDisputa);

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
  const porcentaje = porcentaje_prestador === null || porcentaje_prestador === undefined
    ? null : Number(porcentaje_prestador);
  if (resolucion === 'DIVISION' && (!Number.isFinite(porcentaje) || porcentaje < 0 || porcentaje > 100)) {
    return res.status(400).json({ error: 'Para DIVISION se requiere porcentaje_prestador (0-100).' });
  }
  if (typeof nota_resolucion !== 'string' || nota_resolucion.trim().length < 5 || nota_resolucion.trim().length > 4000) {
    return res.status(400).json({ error: 'La nota de resolución debe tener entre 5 y 4.000 caracteres.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // La resolución cruza registros de wallets, reservas y disputas; se ejecuta
    // como operación de sistema dentro de ESTA transacción financiera.
    await client.query('SET LOCAL ROLE app_system');

    const { rows } = await client.query(
      `SELECT d.*, b.provider_id, b.client_id, b.pago_neto_prestador, b.valor_bruto,
          t.external_id AS wompi_transaction_id, t.status AS payment_status
       FROM disputas d JOIN bookings b ON d.booking_id = b.id
       LEFT JOIN LATERAL (
         SELECT tx.external_id, tx.status FROM transactions tx
         WHERE tx.booking_id = b.id AND LOWER(tx.status) = 'paid'
         ORDER BY tx.id DESC LIMIT 1
       ) t ON TRUE
       WHERE d.id = $1 AND d.estado IN ('ABIERTA','EN_REVISION')
       FOR UPDATE OF d, b`,
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
        montoPrestador = (montoEnDisputa * porcentaje) / 100;
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
           nota_resolucion = $4, resuelto_por = $5, resuelto_at = NOW(),
           reembolso_estado = CASE WHEN $6::numeric > 0 THEN 'PENDIENTE' ELSE 'NO_APLICA' END,
           reembolso_monto = NULLIF($6::numeric, 0),
           reembolso_actualizado_at = CASE WHEN $6::numeric > 0 THEN NOW() ELSE NULL END
       WHERE id = $1`,
      [id, resolucion, resolucion === 'DIVISION' ? porcentaje : null, nota_resolucion.trim(), req.user.id, montoReembolso]
    );

    await client.query(
      `UPDATE bookings SET estado = $2 WHERE id = $1`,
      [disputa.booking_id, montoPrestador > 0 ? 'COMPLETADA' : 'CANCELADA']
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

    let reembolsoEstado = montoReembolso > 0 ? 'PENDIENTE' : 'NO_APLICA';
    if (montoReembolso > 0 && process.env.WOMPI_REFUNDS_V2_ENABLED === 'true'
        && disputa.wompi_transaction_id && String(disputa.payment_status).toLowerCase() === 'paid') {
      const reference = `GLOW-${id}`;
      reembolsoEstado = 'PROCESANDO';
      try {
        await runAsSystem({ pool }, (systemClient) => systemClient.query(
          `UPDATE disputas SET reembolso_estado = 'PROCESANDO',
              reembolso_transaction_id = $2, reembolso_referencia = $3,
              reembolso_actualizado_at = NOW()
           WHERE id = $1 AND reembolso_estado = 'PENDIENTE'`,
          [id, disputa.wompi_transaction_id, reference]));
        const refund = await wompiClient.createRefundV2({
          transactionId: disputa.wompi_transaction_id,
          amountInCents: aCentavos(montoReembolso),
          reason: `Resolución GlowApp ${resolucion}`,
          reference,
        });
        const wompiStatus = String(refund.status || '').toUpperCase();
        reembolsoEstado = wompiStatus === 'APPROVED' ? 'COMPLETADO'
          : ['PENDING', 'PROCESSING'].includes(wompiStatus) ? 'PROCESANDO' : 'FALLIDO';
        await runAsSystem({ pool }, (systemClient) => systemClient.query(
          `UPDATE disputas SET reembolso_estado = $2, reembolso_wompi_id = $3,
              reembolso_actualizado_at = NOW() WHERE id = $1`,
          [id, reembolsoEstado, String(refund.v2_refund_id || refund.id)]));
      } catch (refundError) {
        // Un timeout puede ocurrir después de que Wompi aceptó la solicitud. Se
        // conserva PROCESANDO para impedir un segundo cargo accidental.
        if (refundError?.status) {
          reembolsoEstado = 'FALLIDO';
          await runAsSystem({ pool }, (systemClient) => systemClient.query(
            `UPDATE disputas SET reembolso_estado = 'FALLIDO', reembolso_actualizado_at = NOW() WHERE id = $1`, [id]));
        }
        console.error('[disputas] no se pudo confirmar solicitud de reembolso:', refundError.message);
      }
    }

    const notification = await notifyDisputeUsers({
      userIds: [disputa.client_id, disputa.provider_id], disputeId: id,
      bookingId: disputa.booking_id, actorId: req.user.id,
      message: `GlowApp registró la decisión ${resolucion}.${montoReembolso > 0 ? ` Estado del reembolso: ${reembolsoEstado}.` : ''}`,
    });

    res.json({
      ok: true,
      mensaje: 'Disputa resuelta exitosamente.',
      resolucion,
      monto_liberado_prestador: montoPrestador,
      monto_reembolso_cliente: montoReembolso,
      reembolso_estado: reembolsoEstado,
      notification,
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

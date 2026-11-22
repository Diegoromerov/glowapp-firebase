const crypto = require('crypto');
const { pool } = require('../../config/db');
const { runAsSystem } = require('../../config/tenantRouting');
const emailService = require('../../services/emailService');
const fcm = require('../../services/fcmNotificationService');
const payoutData = require('../../services/payoutSensitiveDataService');

function revisionToken(row) {
  const material = [
    row.provider_id, row.banco, row.numero_cuenta, row.tipo_cuenta,
    row.tipo_cuenta_bancaria, row.titular_nombre, row.titular_documento_tipo,
    row.titular_documento_num, row.cuenta_cambio_solicitado_at?.toISOString?.() || row.cuenta_cambio_solicitado_at,
  ].join('|');
  return crypto.createHash('sha256').update(material).digest('hex');
}

function mask(value) {
  const text = String(value || '');
  return text ? `****${text.slice(-4)}` : null;
}

async function listPending(req, res) {
  const requestedLimit = Number.parseInt(req.query.limit, 10) || 50;
  const limit = Math.max(1, Math.min(requestedLimit, 100));
  const after = Number.parseInt(req.query.after_provider_id, 10) || 0;
  try {
    const resultData = await runAsSystem({ pool }, async (client) => {
      const result = await client.query(
        `SELECT pw.provider_id, u.nombre AS provider_name, u.email,
                pw.banco, pw.tipo_cuenta, pw.tipo_cuenta_bancaria,
                pw.numero_cuenta, pw.titular_nombre,
                pw.titular_documento_tipo, pw.titular_documento_num,
                pw.cuenta_estado_verificacion, pw.cuenta_cambio_solicitado_at,
                pw.cuenta_retiros_bloqueados_hasta, pw.updated_at
           FROM provider_wallet pw
           JOIN usuarios u ON u.id = pw.provider_id
          WHERE pw.cuenta_estado_verificacion = 'PENDIENTE'
            AND pw.numero_cuenta IS NOT NULL
            AND pw.provider_id > $1
          ORDER BY pw.provider_id ASC
          LIMIT $2`, [after, limit]
      );
      const config = await client.query("SELECT value FROM platform_config WHERE key = 'payout_account_review_sla_hours'");
      return { rows: result.rows, slaHours: Math.max(1, Math.min(720, Number.parseInt(config.rows[0]?.value || '48', 10) || 48)) };
    });
    const { rows, slaHours } = resultData;
    return res.json({
      ok: true,
      items: rows.map((storedRow) => {
        const row = payoutData.decryptWallet(storedRow);
        const requestedAt = row.cuenta_cambio_solicitado_at ? new Date(row.cuenta_cambio_solicitado_at) : null;
        return ({
        provider_id: row.provider_id,
        provider_name: row.provider_name,
        email: row.email,
        banco: row.banco,
        tipo_cuenta: row.tipo_cuenta,
        numero_cuenta_enmascarado: mask(row.numero_cuenta),
        titular_nombre: row.titular_nombre,
        titular_documento_tipo: row.titular_documento_tipo,
        titular_documento_enmascarado: mask(row.titular_documento_num),
        estado: row.cuenta_estado_verificacion,
        solicitado_at: row.cuenta_cambio_solicitado_at,
        revision_estimada_at: requestedAt ? new Date(requestedAt.getTime() + slaHours * 60 * 60 * 1000) : null,
        revision_sla_horas: slaHours,
        revision_vencida: Boolean(requestedAt && Date.now() > requestedAt.getTime() + slaHours * 60 * 60 * 1000),
        retiros_habilitables_despues_de: row.cuenta_retiros_bloqueados_hasta,
        revision_token: revisionToken(row),
      });
      }),
      next_after_provider_id: rows.length === limit ? rows[rows.length - 1].provider_id : null,
    });
  } catch (error) {
    console.error('[ADMIN PAYOUT ACCOUNT] Error consultando cola:', error.message);
    return res.status(500).json({ ok: false, error: 'No se pudo consultar la cola de cuentas pendientes.' });
  }
}

async function getPendingDetails(req, res) {
  const providerId = Number.parseInt(req.params.providerId, 10);
  if (!Number.isInteger(providerId) || providerId <= 0) {
    return res.status(400).json({ ok: false, error: 'providerId inválido.' });
  }
  try {
    const resultData = await runAsSystem({ pool }, async (client) => {
      const result = await client.query(
        `SELECT pw.provider_id, u.nombre AS provider_name, u.email,
                pw.banco, pw.tipo_cuenta, pw.tipo_cuenta_bancaria,
                pw.numero_cuenta, pw.titular_nombre,
                pw.titular_documento_tipo, pw.titular_documento_num,
                pw.cuenta_estado_verificacion, pw.cuenta_cambio_solicitado_at,
                pw.cuenta_retiros_bloqueados_hasta, pw.updated_at
           FROM provider_wallet pw
           JOIN usuarios u ON u.id = pw.provider_id
          WHERE pw.provider_id = $1`, [providerId]
      );
      const stored = result.rows[0];
      const current = payoutData.decryptWallet(stored);
      if (current) {
        await client.query(
          `INSERT INTO audit_log (actor_id, accion, tabla, registro_id, datos_despues, ip)
           VALUES ($1, 'CONSULTA_DATOS_CUENTA_RETIRO', 'provider_wallet', $2, $3::jsonb, $4)`,
          [req.admin.id, providerId, JSON.stringify({ motivo: 'revisión administrativa', cuenta: mask(current.numero_cuenta), documento: mask(current.titular_documento_num) }), req.ip || null]
        );
      }
      const config = await client.query("SELECT value FROM platform_config WHERE key = 'payout_account_review_sla_hours'");
      return { row: current || null, slaHours: Math.max(1, Math.min(720, Number.parseInt(config.rows[0]?.value || '48', 10) || 48)) };
    });
    const { row, slaHours } = resultData;
    if (!row) return res.status(404).json({ ok: false, error: 'Cuenta de retiro no encontrada.' });
    return res.json({
      ok: true,
      item: {
        provider_id: row.provider_id,
        provider_name: row.provider_name,
        email: row.email,
        banco: row.banco,
        tipo_cuenta: row.tipo_cuenta,
        tipo_cuenta_bancaria: row.tipo_cuenta_bancaria,
        numero_cuenta: row.numero_cuenta,
        titular_nombre: row.titular_nombre,
        titular_documento_tipo: row.titular_documento_tipo,
        titular_documento_num: row.titular_documento_num,
        estado: row.cuenta_estado_verificacion,
        solicitado_at: row.cuenta_cambio_solicitado_at,
        retiros_habilitables_despues_de: row.cuenta_retiros_bloqueados_hasta,
        revision_token: revisionToken(row),
        revision_sla_horas: slaHours,
        revision_estimada_at: row.cuenta_cambio_solicitado_at
          ? new Date(new Date(row.cuenta_cambio_solicitado_at).getTime() + slaHours * 60 * 60 * 1000)
          : null,
      },
    });
  } catch (error) {
    console.error('[ADMIN PAYOUT ACCOUNT] Error consultando detalle:', error.message);
    return res.status(500).json({ ok: false, error: 'No se pudieron consultar los datos de la cuenta.' });
  }
}

async function decidePending(req, res) {
  const providerId = Number.parseInt(req.params.providerId, 10);
  const decision = String(req.body.decision || '').trim().toUpperCase();
  const reason = String(req.body.motivo || '').trim();
  const submittedRevision = String(req.body.revision_token || '');
  if (!Number.isInteger(providerId) || providerId <= 0 || !['APROBAR', 'RECHAZAR'].includes(decision)) {
    return res.status(400).json({ ok: false, error: 'providerId o decisión inválidos.' });
  }
  if (decision === 'RECHAZAR' && reason.length < 10) {
    return res.status(400).json({ ok: false, error: 'Indica un motivo de rechazo de al menos 10 caracteres.' });
  }
  if (!submittedRevision) {
    return res.status(400).json({ ok: false, error: 'revision_token es obligatorio para evitar decisiones sobre datos desactualizados.' });
  }

  try {
    const result = await runAsSystem({ pool }, async (client) => {
      const currentResult = await client.query(
        `SELECT pw.*, u.nombre AS provider_name, u.email, u.email_verificado, u.fcm_token
           FROM provider_wallet pw JOIN usuarios u ON u.id = pw.provider_id
          WHERE pw.provider_id = $1 FOR UPDATE OF pw`, [providerId]
      );
      const stored = currentResult.rows[0];
      if (!stored || !stored.numero_cuenta) return { status: 404, error: 'Cuenta de retiro no encontrada.' };
      if (stored.cuenta_estado_verificacion !== 'PENDIENTE') {
        return { status: 409, error: 'La cuenta ya no está pendiente de revisión.' };
      }
      const current = payoutData.decryptWallet(stored);
      const expectedRevision = revisionToken(current);
      const a = Buffer.from(expectedRevision, 'hex');
      const b = Buffer.from(submittedRevision, 'hex');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return { status: 409, error: 'Los datos cambiaron desde que abriste la revisión. Recarga la cola y vuelve a revisar.' };
      }
      const approved = decision === 'APROBAR';
      await client.query(
        `UPDATE provider_wallet
            SET cuenta_verificada = $2,
                cuenta_estado_verificacion = $3,
                cuenta_verificada_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
                cuenta_verificada_por = CASE WHEN $2 THEN $4 ELSE NULL END,
                updated_at = NOW()
          WHERE provider_id = $1`,
        [providerId, approved, approved ? 'APROBADA' : 'RECHAZADA', req.admin.id]
      );
      await client.query(
        `INSERT INTO audit_log (actor_id, accion, tabla, registro_id, datos_antes, datos_despues, ip)
         VALUES ($1, $2, 'provider_wallet', $3, $4::jsonb, $5::jsonb, $6)`,
        [
          req.admin.id,
          approved ? 'CUENTA_RETIRO_APROBADA' : 'CUENTA_RETIRO_RECHAZADA',
          providerId,
          JSON.stringify({ estado: current.cuenta_estado_verificacion, cuenta: mask(current.numero_cuenta) }),
          JSON.stringify({ estado: approved ? 'APROBADA' : 'RECHAZADA', motivo: reason || null, cuenta: mask(current.numero_cuenta) }),
          req.ip || null,
        ]
      );
      return {
        status: 200,
        approved,
        providerName: current.provider_name,
        email: current.email,
        emailVerified: current.email_verificado,
        fcmToken: current.fcm_token,
        bankMasked: mask(current.numero_cuenta),
      };
    });

    if (result.status !== 200) return res.status(result.status).json({ ok: false, error: result.error });
    const decisionText = result.approved ? 'aprobada' : 'rechazada';
    const notificationBody = result.approved
      ? `La cuenta ${result.bankMasked} fue aprobada. Los retiros se habilitarán cuando termine el periodo de protección.`
      : `La cuenta ${result.bankMasked} fue rechazada. Motivo: ${reason}`;
    try {
      if (result.email && result.emailVerified === true &&
          (process.env.BREVO_API_KEY || emailService.initEmailService())) {
        await emailService.sendEmail({
          to: result.email,
          subject: `Cuenta de retiro ${decisionText} · GlowApp`,
          data: { html: `<p>Hola ${String(result.providerName || '').replace(/[&<>"']/g, '')}, ${notificationBody}</p>` },
        });
      }
      if (result.fcmToken && fcm.initialized) {
        await fcm.sendPushNotification(result.fcmToken, {
          title: `Cuenta de retiro ${decisionText}`,
          body: notificationBody,
          data: { type: result.approved ? 'PAYOUT_ACCOUNT_APPROVED' : 'PAYOUT_ACCOUNT_REJECTED' },
        });
      }
    } catch (notifyError) {
      console.error('[ADMIN PAYOUT ACCOUNT] No se pudo notificar al prestador:', notifyError.message);
    }
    return res.json({ ok: true, provider_id: providerId, estado: result.approved ? 'APROBADA' : 'RECHAZADA' });
  } catch (error) {
    console.error('[ADMIN PAYOUT ACCOUNT] Error aplicando decisión:', error.message);
    return res.status(500).json({ ok: false, error: 'No se pudo registrar la decisión administrativa.' });
  }
}

module.exports = { listPending, getPendingDetails, decidePending, revisionToken };

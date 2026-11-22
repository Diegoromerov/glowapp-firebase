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

function accountFingerprint(row) {
  return payoutData.fingerprint([
    row.tipo_cuenta, row.banco, row.tipo_cuenta_bancaria, row.numero_cuenta,
  ].join('|'));
}

async function requestEvidence(req, res) {
  const providerId = Number.parseInt(req.params.providerId, 10);
  const reasonCode = String(req.body.reason_code || '').trim().toUpperCase();
  const allowed = new Set(['TITULAR_NO_COINCIDE', 'RECHAZO_TRANSFERENCIA', 'REVISION_RIESGO']);
  if (!Number.isInteger(providerId) || providerId <= 0 || !allowed.has(reasonCode)) {
    return res.status(400).json({ ok: false, error: 'Proveedor o motivo de solicitud inválidos.' });
  }
  try {
    const created = await runAsSystem({ pool }, async (client) => {
      const result = await client.query(
        `SELECT pw.*, u.tenant_id AS provider_tenant_id, u.nombre AS provider_name, u.email, u.email_verificado, u.fcm_token
           FROM provider_wallet pw JOIN usuarios u ON u.id = pw.provider_id
          WHERE pw.provider_id = $1 FOR UPDATE OF pw`, [providerId]
      );
      const stored = result.rows[0];
      if (!stored || !stored.numero_cuenta) return { status: 404 };
      if (stored.cuenta_estado_verificacion !== 'PENDIENTE') return { status: 409 };
      const wallet = payoutData.decryptWallet(stored);
      const evidence = await client.query(
        `INSERT INTO payout_account_review_evidence
          (provider_id, tenant_id, flow_session_id, account_fingerprint, reason_code, requested_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (provider_id) WHERE status IN ('REQUESTED', 'UPLOADED') DO NOTHING
         RETURNING id, requested_at`,
        [providerId, stored.provider_tenant_id || null, stored.cuenta_flow_session_id || null,
          accountFingerprint(wallet), reasonCode, req.admin.id]
      );
      if (!evidence.rowCount) return { status: 409 };
      await client.query(
        `INSERT INTO audit_log (actor_id, accion, tabla, registro_id, datos_despues, ip)
         VALUES ($1, 'SOLICITUD_SOPORTE_CUENTA_RETIRO', 'payout_account_review_evidence', $2, $3::jsonb, $4)`,
        [req.admin.id, evidence.rows[0].id, JSON.stringify({ provider_id: providerId, reason_code: reasonCode }), req.ip || null]
      );
      return { status: 201, ...evidence.rows[0], providerName: stored.provider_name, email: stored.email,
        emailVerified: stored.email_verificado, fcmToken: stored.fcm_token };
    });
    if (created.status !== 201) return res.status(created.status).json({ ok: false, error: created.status === 404 ? 'No se encontró una cuenta para revisar.' : 'La cuenta ya tiene una solicitud de soporte activa o dejó de estar pendiente.' });
    const label = {
      TITULAR_NO_COINCIDE: 'aclarar una diferencia en el titular',
      RECHAZO_TRANSFERENCIA: 'revisar un rechazo de transferencia',
      REVISION_RIESGO: 'completar una revisión de seguridad',
    }[reasonCode];
    const message = `Necesitamos un soporte para ${label} de tu cuenta de retiro. Adjunta un JPG o PNG desde Cuenta de retiro en la app del prestador.`;
    try {
      if (created.email && created.emailVerified === true && (process.env.BREVO_API_KEY || emailService.initEmailService())) {
        await emailService.sendEmail({ to: created.email, subject: 'Soporte solicitado para tu cuenta de retiro · GlowApp', data: { html: `<p>Hola ${String(created.providerName || '').replace(/[&<>"']/g, '')},</p><p>${message}</p>` } });
      }
      if (created.fcmToken && fcm.initialized) await fcm.sendPushNotification(created.fcmToken, { title: 'Soporte solicitado', body: message, data: { type: 'PAYOUT_EVIDENCE_REQUESTED' } });
    } catch (error) { console.error('[ADMIN PAYOUT EVIDENCE] No se pudo notificar:', error.message); }
    return res.status(201).json({ ok: true, evidence_id: created.id, requested_at: created.requested_at });
  } catch (error) {
    console.error('[ADMIN PAYOUT EVIDENCE] No se pudo crear la solicitud:', error.message);
    return res.status(500).json({ ok: false, error: 'No se pudo solicitar el soporte.' });
  }
}

async function getEvidence(req, res) {
  const providerId = Number.parseInt(req.params.providerId, 10);
  if (!Number.isInteger(providerId) || providerId <= 0) return res.status(400).json({ ok: false, error: 'providerId inválido.' });
  try {
    const evidence = await runAsSystem({ pool }, async (client) => {
      const result = await client.query(
        `SELECT id, status, reason_code, requested_at, uploaded_at, reviewed_at,
                file_ciphertext, file_mime_type, file_bytes
           FROM payout_account_review_evidence
          WHERE provider_id = $1 ORDER BY requested_at DESC LIMIT 1`, [providerId]
      );
      const row = result.rows[0];
      if (!row) return null;
      if (row.status === 'UPLOADED') {
        await client.query(
          `INSERT INTO audit_log (actor_id, accion, tabla, registro_id, datos_despues, ip)
           VALUES ($1, 'CONSULTA_SOPORTE_CUENTA_RETIRO', 'payout_account_review_evidence', $2, $3::jsonb, $4)`,
          [req.admin.id, row.id, JSON.stringify({ provider_id: providerId, status: row.status }), req.ip || null]
        );
      }
      return { ...row, file_base64: row.status === 'UPLOADED' && row.file_ciphertext ? payoutData.decrypt(row.file_ciphertext) : null, file_ciphertext: undefined };
    });
    if (!evidence) return res.status(404).json({ ok: false, error: 'No hay solicitudes de soporte para esta cuenta.' });
    res.set('Cache-Control', 'no-store, private');
    return res.json({ ok: true, evidence });
  } catch (error) {
    console.error('[ADMIN PAYOUT EVIDENCE] No se pudo consultar el soporte:', error.message);
    return res.status(500).json({ ok: false, error: 'No se pudo consultar el soporte.' });
  }
}

async function cancelEvidenceRequest(req, res) {
  const providerId = Number.parseInt(req.params.providerId, 10);
  if (!Number.isInteger(providerId) || providerId <= 0) return res.status(400).json({ ok: false, error: 'providerId inválido.' });
  try {
    const result = await runAsSystem({ pool }, async (client) => {
      const updated = await client.query(
        `UPDATE payout_account_review_evidence
            SET status = 'EXPIRED', purge_at = COALESCE(purge_at, NOW())
          WHERE provider_id = $1 AND status = 'REQUESTED'
          RETURNING id`, [providerId]
      );
      if (updated.rowCount) {
        await client.query(
          `INSERT INTO audit_log (actor_id, accion, tabla, registro_id, datos_despues, ip)
           VALUES ($1, 'CANCELA_SOLICITUD_SOPORTE_CUENTA_RETIRO', 'payout_account_review_evidence', $2, $3::jsonb, $4)`,
          [req.admin.id, updated.rows[0].id, JSON.stringify({ provider_id: providerId }), req.ip || null]
        );
      }
      return updated.rowCount;
    });
    if (!result) return res.status(409).json({ ok: false, error: 'No hay una solicitud pendiente de carga para cancelar.' });
    return res.json({ ok: true });
  } catch (error) {
    console.error('[ADMIN PAYOUT EVIDENCE] No se pudo cancelar la solicitud:', error.message);
    return res.status(500).json({ ok: false, error: 'No se pudo cancelar la solicitud.' });
  }
}

async function getMetrics(req, res) {
  const days = Math.max(1, Math.min(365, Number.parseInt(req.query.days, 10) || 90));
  try {
    const metrics = await runAsSystem({ pool }, async (client) => {
      const result = await client.query(
        `SELECT COUNT(*)::int AS starts,
                COUNT(*) FILTER (WHERE status IN ('SUBMITTED','APPROVED','REJECTED'))::int AS submitted,
                COUNT(*) FILTER (WHERE status = 'ABANDONED')::int AS abandoned,
                COUNT(*) FILTER (WHERE status = 'REJECTED')::int AS rejected,
                COUNT(*) FILTER (WHERE support_opened_at IS NOT NULL)::int AS support_opened,
                COALESCE(SUM(transfer_failures), 0)::int AS transfer_failures,
                ROUND(AVG(EXTRACT(EPOCH FROM (reviewed_at - submitted_at)) / 3600)::numeric, 1) AS avg_review_hours
           FROM payout_account_flow_sessions
          WHERE started_at >= NOW() - ($1::int * INTERVAL '1 day')`, [days]
      );
      return result.rows[0];
    });
    return res.json({ ok: true, days, metrics });
  } catch (error) {
    console.error('[ADMIN PAYOUT METRICS] No se pudieron consultar métricas:', error.message);
    return res.status(500).json({ ok: false, error: 'No se pudieron consultar las métricas.' });
  }
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
      revision_sla_horas: slaHours,
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
      const evidence = await client.query(
        `SELECT id, status FROM payout_account_review_evidence
          WHERE provider_id = $1 AND status IN ('REQUESTED', 'UPLOADED')
          ORDER BY requested_at DESC LIMIT 1 FOR UPDATE`, [providerId]
      );
      if (evidence.rows[0]?.status === 'REQUESTED') {
        return { status: 409, error: 'Hay un soporte solicitado que el prestador aún no ha cargado.' };
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
      if (evidence.rows[0]?.status === 'UPLOADED') {
        await client.query(
          `UPDATE payout_account_review_evidence
              SET status = 'REVIEWED', reviewed_by = $2, reviewed_at = NOW(),
                  purge_at = NOW() + INTERVAL '30 days'
            WHERE id = $1`, [evidence.rows[0].id, req.admin.id]
        );
      }
      if (stored.cuenta_flow_session_id) {
        await client.query(
          `UPDATE payout_account_flow_sessions
              SET status = $2, reviewed_at = NOW(), closed_at = COALESCE(closed_at, NOW())
            WHERE id = $1`, [stored.cuenta_flow_session_id, approved ? 'APPROVED' : 'REJECTED']
        );
      }
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

module.exports = { listPending, getPendingDetails, decidePending, requestEvidence, cancelEvidenceRequest, getEvidence, getMetrics, revisionToken };

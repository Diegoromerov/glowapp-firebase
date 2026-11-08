const { pool } = require('../config/db');
const emailService = require('../services/emailService');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BATCH_SIZE = 25;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function deliveryConfigured() {
  return Boolean(process.env.BREVO_API_KEY)
    || Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

exports.list = async (req, res) => {
  const result = await pool.query(`
    SELECT c.id, c.subject, c.status, c.created_at, c.started_at, c.completed_at,
      COUNT(d.id)::int AS recipients,
      COUNT(d.id) FILTER (WHERE d.status = 'SENT')::int AS sent,
      COUNT(d.id) FILTER (WHERE d.status = 'FAILED')::int AS failed,
      COUNT(d.id) FILTER (WHERE d.status = 'PENDING')::int AS pending
    FROM newsletter_campaigns c
    LEFT JOIN newsletter_deliveries d ON d.campaign_id = c.id
    GROUP BY c.id ORDER BY c.created_at DESC LIMIT 100`);
  return res.json({ success: true, data: result.rows });
};

exports.create = async (req, res) => {
  const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
  const bodyText = typeof req.body?.body_text === 'string' ? req.body.body_text.trim() : '';
  if (subject.length < 3 || subject.length > 160 || bodyText.length < 10 || bodyText.length > 10000) {
    return res.status(400).json({ error: 'invalid_campaign', message: 'Asunto (3–160) y texto (10–10000 caracteres) son obligatorios.' });
  }
  const result = await pool.query(`
    INSERT INTO newsletter_campaigns (subject, body_text, created_by)
    VALUES ($1, $2, $3)
    RETURNING id, subject, status, created_at`, [subject, bodyText, req.user.id]);
  return res.status(201).json({ success: true, data: result.rows[0] });
};

exports.sendBatch = async (req, res) => {
  const { id } = req.params;
  if (!UUID.test(id)) return res.status(400).json({ error: 'invalid_campaign_id' });
  if (!deliveryConfigured()) {
    return res.status(503).json({ error: 'email_provider_unconfigured', message: 'Configura Brevo o SMTP antes de enviar campañas.' });
  }

  const campaignResult = await pool.query(
    `SELECT id, subject, body_text, status FROM newsletter_campaigns WHERE id = $1`, [id]);
  const campaign = campaignResult.rows[0];
  if (!campaign) return res.status(404).json({ error: 'campaign_not_found' });
  if (campaign.status === 'COMPLETED') return res.status(409).json({ error: 'campaign_completed' });

  await pool.query(`
    INSERT INTO newsletter_deliveries (campaign_id, user_id)
    SELECT $1, u.id
      FROM usuarios u JOIN user_preferences p ON p.user_id = u.id
     WHERE p.marketing_enabled = TRUE AND u.email IS NOT NULL AND u.email <> ''
    ON CONFLICT (campaign_id, user_id) DO NOTHING`, [id]);
  await pool.query(`UPDATE newsletter_deliveries SET status = 'PENDING', failure_code = NULL
    WHERE campaign_id = $1 AND status = 'FAILED'`, [id]);
  await pool.query(`UPDATE newsletter_campaigns SET status = 'SENDING', started_at = COALESCE(started_at, NOW()) WHERE id = $1`, [id]);

  const client = await pool.connect();
  let claimed = [];
  try {
    await client.query('BEGIN');
    const selected = await client.query(`SELECT id, user_id FROM newsletter_deliveries
      WHERE campaign_id = $1 AND status = 'PENDING'
      ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED`, [id, BATCH_SIZE]);
    const ids = selected.rows.map((row) => row.id);
    if (ids.length) {
      const updated = await client.query(`UPDATE newsletter_deliveries SET status = 'SENDING'
        WHERE id = ANY($1::bigint[]) RETURNING id, user_id`, [ids]);
      claimed = updated.rows;
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const frontend = (process.env.CLIENT_APP_URL || 'https://glowapp-client.web.app').replace(/\/$/, '');
  const unsubscribeText = `\n\nDejas de recibir estas novedades en Perfil > Configuración > Novedades o desde ${frontend}/#/settings.`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;line-height:1.6"><h2>${escapeHtml(campaign.subject)}</h2><p>${escapeHtml(campaign.body_text).replace(/\n/g, '<br>')}</p><hr><small>Recibes este correo porque autorizaste novedades de GlowApp. Para retirar tu autorización, visita <a href="${escapeHtml(frontend)}/#/settings">Configuración</a>.</small></div>`;

  for (const recipient of claimed) {
    try {
      const current = await pool.query(`SELECT u.email FROM usuarios u
        JOIN user_preferences p ON p.user_id = u.id
        WHERE u.id = $1 AND p.marketing_enabled = TRUE AND u.email IS NOT NULL AND u.email <> ''`, [recipient.user_id]);
      if (!current.rows.length) {
        await pool.query(`UPDATE newsletter_deliveries SET status = 'SKIPPED', failure_code = 'CONSENT_WITHDRAWN'
          WHERE id = $1`, [recipient.id]);
        continue;
      }
      const sent = await emailService.sendEmail({
        to: current.rows[0].email,
        subject: campaign.subject,
        data: { html, text: `${campaign.subject}\n\n${campaign.body_text}${unsubscribeText}` },
      });
      if (!sent || sent.devMode) throw new Error('delivery_not_confirmed');
      await pool.query(`UPDATE newsletter_deliveries SET status = 'SENT', provider = $2, provider_message_id = $3
        WHERE id = $1`, [recipient.id, sent.via || 'smtp', sent.messageId || null]);
    } catch (_) {
      await pool.query(`UPDATE newsletter_deliveries SET status = 'FAILED', failure_code = 'PROVIDER_ERROR'
        WHERE id = $1`, [recipient.id]);
    }
  }

  const counts = await pool.query(`SELECT
    COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending,
    COUNT(*) FILTER (WHERE status = 'SENDING')::int AS sending,
    COUNT(*) FILTER (WHERE status = 'SENT')::int AS sent,
    COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed,
    COUNT(*) FILTER (WHERE status = 'SKIPPED')::int AS skipped
    FROM newsletter_deliveries WHERE campaign_id = $1`, [id]);
  const state = counts.rows[0].pending || counts.rows[0].sending
    ? 'SENDING'
    : counts.rows[0].failed ? 'PARTIAL' : 'COMPLETED';
  await pool.query(`UPDATE newsletter_campaigns SET status = $2,
    completed_at = CASE WHEN $2 IN ('COMPLETED','PARTIAL') THEN NOW() ELSE NULL END
    WHERE id = $1`, [id, state]);
  return res.json({ success: true, campaign_id: id, status: state, batch_processed: claimed.length, ...counts.rows[0] });
};

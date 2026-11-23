// Recordatorios de reservas transaccionales, medidos por negocio y canal.
// Este módulo no consume la cuota SaaS ONLINE_BOOKING: los intentos/sends y
// los costos observados se consultan en booking_reminder_deliveries.
const { pool, systemPool } = require('../config/db');
const { runAsSystem } = require('../config/tenantRouting');
const { sendPushToUser } = require('../services/pushNotificationService');
const { sendAbandonedBookingEmail } = require('../services/emailService');
const fcm = require('../services/fcmNotificationService');

const REMINDER_KIND = 'ABANDONED_PAYMENT';
const INTERVAL_MS = 15 * 60 * 1000;
const BATCH_SIZE = 50;
let timer = null;

function getConfiguredUnitCost(channel, provider) {
  const variable = channel === 'PUSH'
    ? 'REMINDER_COST_COP_PER_FCM'
    : provider === 'BREVO'
      ? 'REMINDER_COST_COP_PER_BREVO'
      : 'REMINDER_COST_COP_PER_SMTP';
  const raw = process.env[variable];
  if (raw === undefined || raw.trim() === '') return null;
  const normalized = raw.trim();
  if (!/^(?:\d{1,6}(?:\.\d{1,6})?|\.\d{1,6})$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? { amount, currency: 'COP', source: `ENV:${variable}` } : null;
}

async function claimChannel(row, channel, provider) {
  // El claim se confirma antes del proveedor y evita envíos concurrentes. Si el
  // proceso cae entre aceptación externa y registro local, el resultado queda
  // ambiguo y se reintenta; los proveedores actuales no comparten idempotency key.
  const result = await runAsSystem({ pool, systemPool }, (client) => client.query(
    `INSERT INTO booking_reminder_deliveries
       (business_profile_id, booking_id, reminder_kind, channel, provider, status)
     VALUES ($1, $2, $3, $4, $5, 'PENDING')
     ON CONFLICT (booking_id, reminder_kind, channel) DO UPDATE
       SET status = 'PENDING', provider = EXCLUDED.provider,
           attempted_at = NOW(), error_code = NULL, provider_message_id = NULL,
           attempt_count = booking_reminder_deliveries.attempt_count + 1
       WHERE booking_reminder_deliveries.status = 'FAILED'
         AND booking_reminder_deliveries.attempted_at < NOW() - INTERVAL '15 minutes'
     RETURNING id`,
    [row.business_profile_id, row.id, REMINDER_KIND, channel, provider]
  ));
  return result.rows[0]?.id || null;
}

async function finishChannel(deliveryId, { sent, messageId, errorCode, cost }) {
  await runAsSystem({ pool, systemPool }, (client) => client.query(
    `UPDATE booking_reminder_deliveries
        SET status = $2,
            provider_message_id = $3,
            error_code = $4,
            delivered_at = CASE WHEN $2 = 'SENT' THEN NOW() ELSE NULL END,
            cost_amount = CASE WHEN $2 = 'SENT' THEN $5 ELSE NULL END,
            cost_currency = CASE WHEN $2 = 'SENT' THEN $6 ELSE NULL END,
            cost_source = CASE WHEN $2 = 'SENT' THEN $7 ELSE NULL END
      WHERE id = $1 AND status = 'PENDING'`,
    [deliveryId, sent ? 'SENT' : 'FAILED', messageId || null, errorCode || null,
      cost?.amount ?? null, cost?.currency ?? null, cost?.source ?? null]
  ));
}

/**
 * Envía como máximo un mensaje por reserva/canal. Solo incluye reservas de
 * proveedores que ya están relacionados de forma explícita con un perfil SaaS.
 */
async function processAbandonedBookings() {
  await runAsSystem({ pool, systemPool }, (client) => client.query(
    `UPDATE booking_reminder_deliveries
        SET status = 'FAILED', error_code = 'WORKER_INTERRUPTED'
      WHERE reminder_kind = $1 AND status = 'PENDING'
        AND attempted_at < NOW() - INTERVAL '15 minutes'`,
    [REMINDER_KIND]
  ));

  const bookings = await runAsSystem({ pool, systemPool }, (client) => client.query(
      `SELECT b.id, b.client_id, b.business_profile_id,
              COALESCE(s.name, 'Servicio de belleza') AS service_name,
              u.nombre AS client_name, u.email AS client_email,
              u.fcm_token, COALESCE(up.push_enabled, true) AS push_enabled
         FROM bookings b
         LEFT JOIN services s ON s.id = b.service_id
         JOIN usuarios u ON u.id = b.client_id AND u.is_active = true
         LEFT JOIN user_preferences up ON up.user_id = u.id
        WHERE b.business_profile_id IS NOT NULL
          AND b.estado = 'PENDIENTE_PAGO'
          AND COALESCE(b.payment_status, '') <> 'paid'
          AND b.scheduled_at > NOW()
          AND COALESCE(b.productos_adicionales->>'primary_booking_id', b.id::text) = b.id::text
          AND b.created_at < NOW() - INTERVAL '2 hours'
          AND NOT EXISTS (
            SELECT 1 FROM booking_reminder_deliveries d
             WHERE d.booking_id = b.id AND d.reminder_kind = $1
               AND d.status = 'PENDING'
               AND d.attempted_at >= NOW() - INTERVAL '15 minutes'
          )
          AND EXISTS (
            SELECT 1 FROM (VALUES ('PUSH'), ('EMAIL')) AS channel_needed(channel)
             WHERE NOT EXISTS (
               SELECT 1 FROM booking_reminder_deliveries d
                WHERE d.booking_id = b.id AND d.reminder_kind = $1
                  AND d.channel = channel_needed.channel
                  AND d.status IN ('SENT', 'SKIPPED')
             )
               AND (
                 NOT EXISTS (
                   SELECT 1 FROM booking_reminder_deliveries d
                    WHERE d.booking_id = b.id AND d.reminder_kind = $1
                      AND d.channel = channel_needed.channel
                 )
                 OR EXISTS (
                   SELECT 1 FROM booking_reminder_deliveries d
                    WHERE d.booking_id = b.id AND d.reminder_kind = $1
                      AND d.channel = channel_needed.channel
                      AND d.status = 'FAILED'
                      AND d.attempted_at < NOW() - INTERVAL '15 minutes'
                 )
               )
          )
        ORDER BY b.created_at ASC
        LIMIT $2`,
      [REMINDER_KIND, BATCH_SIZE]
  ));

    let processed = 0;
    let sentMessages = 0;
    for (const row of bookings.rows) {
      const channels = [
        { channel: 'PUSH', provider: 'FCM' },
        {
          channel: 'EMAIL',
          provider: process.env.BREVO_API_KEY
            ? 'BREVO'
            : (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS ? 'SMTP' : 'DEV'),
        },
      ];

      for (const { channel, provider } of channels) {
        const deliveryId = await claimChannel(row, channel, provider);
        if (!deliveryId) continue;

        try {
          if (channel === 'PUSH') {
            if (!row.fcm_token || !row.push_enabled || !fcm.initialized) {
              await runAsSystem({ pool, systemPool }, (client) => client.query(
                `UPDATE booking_reminder_deliveries SET status = 'SKIPPED', error_code = $2
                  WHERE id = $1 AND status = 'PENDING'`,
                [deliveryId, !row.fcm_token ? 'NO_DEVICE_TOKEN' : !row.push_enabled ? 'PUSH_DISABLED' : 'FCM_UNCONFIGURED']
              ));
              continue;
            }
            const sent = await sendPushToUser(
              row.client_id,
              '¡Tu cita de belleza te espera! ✨',
              `Conserva tu cupo reservado para ${row.service_name}. Toca para completar tu pago.`,
              { booking_id: String(row.id), type: REMINDER_KIND },
              { user: { id: row.client_id, fcm_token: row.fcm_token, push_enabled: row.push_enabled } }
            );
            await finishChannel(deliveryId, {
              sent,
              errorCode: sent ? null : 'NOT_DELIVERED_OR_DISABLED',
              cost: sent ? getConfiguredUnitCost(channel, 'FCM') : null,
            });
            if (sent) sentMessages += 1;
            continue;
          }

          if (!row.client_email || provider === 'DEV') {
            await runAsSystem({ pool, systemPool }, (client) => client.query(
              `UPDATE booking_reminder_deliveries SET status = 'SKIPPED', error_code = $2
                WHERE id = $1 AND status = 'PENDING'`,
              [deliveryId, !row.client_email ? 'NO_EMAIL' : 'EMAIL_PROVIDER_UNCONFIGURED']
            ));
            continue;
          }

          const result = await sendAbandonedBookingEmail(
            row.client_email,
            row.client_name || 'Cliente',
            row.id,
            row.service_name
          );
          const accepted = Boolean(result?.messageId) && !result?.devMode;
          await finishChannel(deliveryId, {
            sent: accepted,
            messageId: accepted ? result.messageId : null,
            errorCode: accepted ? null : 'PROVIDER_DID_NOT_CONFIRM',
            cost: accepted ? getConfiguredUnitCost(channel, provider) : null,
          });
          if (accepted) sentMessages += 1;
        } catch (error) {
          await finishChannel(deliveryId, {
            sent: false,
            errorCode: String(error.code || 'SEND_FAILED').slice(0, 80),
          });
          console.error(`[CRON REMINDERS] Falló el proveedor del canal ${channel}.`);
        }
      }

      processed += 1;
    }

  return { skipped: false, processed, sentMessages, candidates: bookings.rows.length };
}

function programarSiguiente() {
  timer = setTimeout(async () => {
    try {
      const result = await processAbandonedBookings();
      console.log('[CRON REMINDERS] Ciclo finalizado:', JSON.stringify(result));
    } catch (error) {
      console.error('[CRON REMINDERS] Error:', error.message);
    } finally {
      programarSiguiente();
    }
  }, INTERVAL_MS);
  timer.unref?.();
  return timer;
}

function iniciarRecordatoriosReservasCron() {
  if (timer) return timer;
  console.log('[CRON REMINDERS] Recordatorios de pago abandonado cada 15 minutos');
  return programarSiguiente();
}

if (require.main === module) {
  processAbandonedBookings()
    .then((result) => console.log('[CRON REMINDERS] Ejecución manual finalizada:', JSON.stringify(result)))
    .then(() => process.exit(0))
    .catch((error) => { console.error(error); process.exit(1); });
}

module.exports = {
  processAbandonedBookings,
  iniciarRecordatoriosReservasCron,
};

'use strict';

const { pool } = require('../config/db');
const { runAsSystem } = require('../config/tenantRouting');
const emailService = require('./emailService');
const fcm = require('./fcmNotificationService');

/** Avisos best-effort: el fallo de un canal nunca revierte el expediente. */
async function notifyDisputeUsers({ userIds, disputeId, bookingId, actorId, message }) {
  const ids = [...new Set((userIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0 && id !== Number(actorId)))];
  if (!ids.length) return { status: 'no_recipients' };
  try {
    const users = await runAsSystem({ pool }, (client) => client.query(
      'SELECT id, email, fcm_token FROM usuarios WHERE id = ANY($1::integer[])', [ids]));
    const configuredEmail = Boolean(process.env.BREVO_API_KEY ||
      (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS));
    const sends = [];
    for (const user of users.rows) {
      const text = [
        'Hola,', '', 'Hay una actualización en una disputa de servicio de GlowApp.',
        `Caso: ${disputeId}`, `Cita: ${bookingId}`, '', message || 'Ingresa a GlowApp para consultar el expediente.',
        '', 'Consulta el caso en GlowApp. No respondas a este correo.',
      ].join('\n');
      if (configuredEmail && user.email) sends.push(emailService.sendEmail({
        to: user.email,
        subject: 'GlowApp: actualización de una disputa de servicio',
        data: { text },
      }));
      if (user.fcm_token && fcm?.sendPushNotification) sends.push(fcm.sendPushNotification(user.fcm_token, {
        title: 'Actualización de disputa',
        body: 'Abre GlowApp para consultar el expediente de tu cita.',
        data: { type: 'SERVICE_DISPUTE_UPDATE', disputeId: String(disputeId), bookingId: String(bookingId) },
      }));
    }
    const outcomes = await Promise.allSettled(sends);
    const failed = outcomes.filter((result) => result.status === 'rejected').length;
    return { status: failed ? 'partial' : sends.length ? 'sent' : 'not_configured', failed };
  } catch (error) {
    console.error('[disputas] notificación fallida:', error.message);
    return { status: 'failed' };
  }
}

module.exports = { notifyDisputeUsers };

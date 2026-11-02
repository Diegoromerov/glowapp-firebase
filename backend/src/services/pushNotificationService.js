// backend/src/services/pushNotificationService.js
const { pool } = require('../config/db');

/**
 * Enviar notificación Push a un usuario específico mediante su fcm_token almacenado
 */
async function sendPushToUser(userId, title, body, dataPayload = {}) {
  try {
    const userRes = await pool.query(
      `SELECT u.id, u.email, u.fcm_token, 
              COALESCE(up.push_enabled, true) as push_enabled
       FROM usuarios u
       LEFT JOIN user_preferences up ON up.user_id = u.id
       WHERE u.id = $1 AND u.is_active = true`,
      [userId]
    );

    if (userRes.rows.length === 0 || !userRes.rows[0].fcm_token) {
      console.log(`⚠️ Push no enviado: Usuario ID ${userId} no tiene token FCM registrado.`);
      return false;
    }

    const user = userRes.rows[0];
    
    // Verificar preferencia de push
    if (!user.push_enabled) {
      console.log(`🔕 Push no enviado: Usuario ID ${userId} tiene notificaciones push deshabilitadas.`);
      return false;
    }

    const fcmToken = user.fcm_token;
    console.log(`🚀 [Push Notification Payload] Enviando a User ${userId} (Token: ${fcmToken.substring(0, 15)}...):`);
    console.log(`   Título: "${title}" | Cuerpo: "${body}"`);

    return true;
  } catch (err) {
    console.error(`❌ Error enviando Push Notification a usuario ID ${userId}:`, err.message);
    return false;
  }
}

/**
 * Enviar notificación Push masiva por rol (ej: PRESTADOR o CLIENTE)
 */
async function sendPushToRole(role, title, body, dataPayload = {}) {
  try {
    const res = await pool.query(
      `SELECT u.id, u.fcm_token, COALESCE(up.push_enabled, true) as push_enabled
       FROM usuarios u
       LEFT JOIN user_preferences up ON up.user_id = u.id
       WHERE u.rol = $1 AND u.fcm_token IS NOT NULL AND u.is_active = true`,
      [role.toUpperCase()]
    );

    let sentCount = 0;
    for (let u of res.rows) {
      if (u.push_enabled) {
        await sendPushToUser(u.id, title, body, dataPayload);
        sentCount++;
      } else {
        console.log(`🔕 Push omitido para User ${u.id}: notificaciones push deshabilitadas`);
      }
    }
    
    console.log(`📢 [Push Masivo FCM] Enviando notificación a ${sentCount} de ${res.rows.length} usuarios con rol ${role} (push_enabled=true)`);
    return sentCount;
  } catch (err) {
    console.error(`❌ Error en envío masivo de Push Notification por rol ${role}:`, err.message);
    return 0;
  }
}

module.exports = {
  sendPushToUser,
  sendPushToRole,
};

// backend/src/crons/abandonedCartCron.js
const { pool } = require('../config/db');
const { sendPushToUser } = require('../services/pushNotificationService');
const { sendAbandonedBookingEmail } = require('../services/emailService');

/**
 * Worker Cron para procesar reservas abandonadas (PENDIENTE_PAGO > 2 horas)
 */
async function processAbandonedBookings() {
  console.log('🔄 [CRON RE-ENGAGEMENT] Escaneando reservas abandonadas...');
  try {
    const res = await pool.query(`
      SELECT b.id, b.client_id, b.created_at, s.title as service_name, u.nombre as client_name, u.email as client_email
      FROM bookings b
      JOIN usuarios u ON b.client_id = u.id
      LEFT JOIN services s ON b.service_id = s.id
      WHERE (b.status = 'PENDIENTE_PAGO' OR b.status = 'PENDIENTE')
        AND b.created_at < NOW() - INTERVAL '2 hours'
        AND COALESCE(b.reminder_sent, false) = false
      LIMIT 50
    `);

    console.log(`📊 Reservas abandonadas detectadas para re-engagement: ${res.rows.length}`);

    for (let row of res.rows) {
      const serviceName = row.service_name || 'Servicio de Belleza';
      
      // 1. Disparar Push Notification
      await sendPushToUser(
        row.client_id,
        '¡Tu cita de belleza te espera! ✨',
        `Conserva tu cupo reservado para ${serviceName}. Toca para completar tu pago.`,
        { booking_id: row.id.toString(), type: 'ABANDONED_BOOKING' }
      );

      // 2. Disparar Email Transaccional
      if (row.client_email) {
        await sendAbandonedBookingEmail(
          row.client_email,
          row.client_name || 'Cliente',
          row.id,
          serviceName
        );
      }

      // 3. Marcar reminder_sent = true en la base de datos
      await pool.query(
        `UPDATE bookings SET reminder_sent = true WHERE id = $1`,
        [row.id]
      );
    }

    return res.rows.length;
  } catch (err) {
    console.error('❌ Error ejecutando Cron de Reservas Abandonadas:', err.message);
    return 0;
  }
}

// Permitir ejecución directa por línea de comandos o invocación por programador
if (require.main === module) {
  processAbandonedBookings().then((count) => {
    console.log(`✅ Cron finalizado. Notificaciones procesadas: ${count}`);
    process.exit(0);
  });
}

module.exports = {
  processAbandonedBookings,
};

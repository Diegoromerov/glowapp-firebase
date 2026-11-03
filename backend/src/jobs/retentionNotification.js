// backend/src/jobs/retentionNotification.js
const { pool } = require('../config/db');

/**
 * Job diario que revisa qué clientes tienen más de 30 días de inactividad desde su última cita
 * de manicura u otros servicios y les envía una notificación o correo promocional.
 */
async function enviarNotificacionesRetencion() {
  console.log('⚙️  Buscando clientes inactivos para enviar recordatorios de retención...');
  try {
    const query = `
      SELECT DISTINCT ON (b.client_id)
        b.client_id,
        u.nombre as nombre_cliente,
        u.email as email_cliente,
        u.phone as telefono_cliente,
        b.scheduled_at as fecha_ultima_cita
      FROM bookings b
      JOIN usuarios u ON b.client_id = u.id
      WHERE b.estado = 'COMPLETADA'
        AND b.scheduled_at < NOW() - INTERVAL '30 days'
      ORDER BY b.client_id, b.scheduled_at DESC;
    `;

    const { rows: clientesInactivos } = await pool.query(query);
    console.log(`📊 Se encontraron ${clientesInactivos.length} clientes inactivos para retención.`);

    for (const cliente of clientesInactivos) {
      console.log(`✉️  Enviando recordatorio automático de retención a: ${cliente.nombre_cliente} (${cliente.email_cliente})`);
      // Aquí se integraría el envío real de correo o SMS a través de SendGrid/Twilio/FCM
    }

    console.log('✅ Notificaciones de retención procesadas.');
  } catch (error) {
    console.error('❌ Error en job de notificaciones de retención:', error.message);
  }
}

module.exports = { enviarNotificacionesRetencion };

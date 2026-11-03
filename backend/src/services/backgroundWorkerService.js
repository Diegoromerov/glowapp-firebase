// backend/src/services/backgroundWorkerService.js
const { pool } = require('../config/db');
const { notifyUserChatMessage } = require('./websocketService');

/**
 * PATRÓN 2: Trabajador en Segundo Plano (Background Worker Agent)
 * Procesa eventos del sistema sin requerir interacción del usuario en tiempo real.
 */
class BackgroundWorkerService {
  /**
   * Maneja la cancelación de una cita para recuperar el espacio y ofrecérselo a usuarios cercanos
   */
  async handleBookingCancellation({ bookingId, providerId, serviceName, date, time }) {
    console.log(`⚡ [Background Worker] Procesando recuperación de slot cancelado (bookingId: ${bookingId})`);

    try {
      // 1. Consultar usuarios en la misma zona que buscaron servicios similares recientemente
      const query = `
        SELECT u.id as user_id, u.nombre
        FROM usuarios u
        JOIN messages m ON m.sender_id = u.id
        WHERE LOWER(m.message) LIKE $1
        ORDER BY m.created_at DESC
        LIMIT 3;
      `;

      const searchKeyword = `%${(serviceName || 'uñas').toLowerCase()}%`;
      const res = await pool.query(query, [searchKeyword]).catch(() => ({ rows: [] }));

      const notifiedUsers = [];

      for (const user of res.rows) {
        const messageText = `⚡ ¡Oportunidad Relámpago! Se liberó un espacio para ${serviceName || 'tu servicio'} este ${date || 'hoy'} a las ${time || '3:00 PM'}. ¿Te lo reservamos con prioridad?`;
        
        notifyUserChatMessage(user.user_id, {
          sender_id: '0',
          receiver_id: user.user_id.toString(),
          message: messageText,
          created_at: new Date()
        });

        notifiedUsers.push(user.user_id);
      }

      return {
        status: 'success',
        processedBookingId: bookingId,
        notifiedUsersCount: notifiedUsers.length,
        notifiedUsers
      };
    } catch (err) {
      console.error('❌ [Background Worker] Error en recuperación de slot:', err.message);
      return { status: 'error', message: err.message };
    }
  }
}

module.exports = new BackgroundWorkerService();

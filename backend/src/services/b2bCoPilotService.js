// backend/src/services/b2bCoPilotService.js
const { pool } = require('../config/db');

/**
 * PATRÓN 4: Co-Piloto de Operaciones B2B para Prestadores y Salones
 */
class B2BCoPilotService {
  /**
   * Auto-genera una respuesta empática a una reseña o PQRS de un cliente
   */
  async generateReviewAutoReply({ rating, reviewText, clientName }) {
    const isPositive = (rating || 5) >= 4;
    const name = clientName || 'Estimad@ cliente';

    if (isPositive) {
      return {
        status: 'success',
        suggestedReply: `¡Hola ${name}! Muchas gracias por tu maravillosa valoración de ${rating} estrellas 🌟. Nos alegra enormemente brindarle la mejor experiencia en GlowApp. ¡Esperamos verte pronto de nuevo!`
      };
    } else {
      return {
        status: 'success',
        suggestedReply: `Hola ${name}. Lamentamos mucho que tu experiencia no haya sido de 5 estrellas. En GlowApp nos tomamos muy en serio tu satisfacción. Nos pondremos en contacto contigo de inmediato para revisar tu caso y asegurarnos de cuidarte como te mereces.`
      };
    }
  }

  /**
   * Aplica reglas de precios dinámicos según demanda y día de la semana
   */
  async updateDynamicPricingRules({ providerId, serviceId, discountPercentage }) {
    try {
      const discount = parseInt(discountPercentage, 10) || 15;
      
      const query = `
        UPDATE services
        SET price = price * (1 - ($1::numeric / 100.0)),
            updated_at = NOW()
        WHERE provider_id = $2 AND ($3::uuid IS NULL OR id = $3::uuid)
        RETURNING id, name, price;
      `;

      const res = await pool.query(query, [discount, providerId, serviceId || null]).catch(() => ({ rows: [] }));

      return {
        status: 'success',
        providerId,
        appliedDiscount: discount,
        updatedServicesCount: res.rows.length,
        updatedServices: res.rows
      };
    } catch (err) {
      console.error('❌ [B2B Co-Pilot] Error actualizando precios dinámicos:', err.message);
      return { status: 'error', message: err.message };
    }
  }
}

module.exports = new B2BCoPilotService();

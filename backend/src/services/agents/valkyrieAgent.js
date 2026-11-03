// backend/src/services/agents/valkyrieAgent.js
const { pool } = require('../../config/db');

/**
 * AGENTE VALKYRIE: Co-Piloto B2B de Inteligencia de Mercado y Precios Dinámicos para Prestadores
 */
class ValkyrieAgent {
  DAY_NAMES = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

  /**
   * Genera análisis de ocupación y recomendaciones de precios dinámicos para un prestador
   * @param {Object} params - { providerId }
   * @returns {Promise<Object>} Reporte de ocupación y sugerencias de descuentos
   */
  async getProviderInsights({ providerId }) {
    const parsedProviderId = parseInt(providerId, 10);
    if (isNaN(parsedProviderId)) {
      return { status: 'error', message: 'providerId inválido' };
    }

    try {
      // 1. Consultar distribución de agendamientos por día de la semana en los últimos 30 días
      const query = `
        SELECT 
          EXTRACT(ISODOW FROM scheduled_at) as day_of_week,
          COUNT(id) as total_bookings
        FROM bookings
        WHERE provider_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
        GROUP BY day_of_week
        ORDER BY total_bookings ASC;
      `;

      const res = await pool.query(query, [parsedProviderId]);

      if (!res.rows || res.rows.length === 0) {
        return {
          status: 'no_data',
          providerId: parsedProviderId,
          insights: {
            slowestDay: null,
            slowestDayBookingsMonth: 0,
            recommendation: 'No hay suficientes datos de agendamiento en los últimos 30 días para calcular precios dinámicos.',
            dynamicPromotion: {
              authorized: false,
              discountPercentage: 0,
              targetDay: null,
              targetTimeWindow: null,
              promoCode: null
            }
          }
        };
      }

      const slowestDayNum = parseInt(res.rows[0].day_of_week, 10);
      const slowestDayName = this.DAY_NAMES[slowestDayNum] || 'Martes';
      const totalBookingsSlowDay = parseInt(res.rows[0].total_bookings, 10);

      // 2. Generar recomendación de precio dinámico basada en datos reales
      const discountPercentage = 15;
      const dynamicPromo = {
        authorized: true,
        discountPercentage,
        targetDay: slowestDayName,
        targetTimeWindow: 'Mañana (09:00 AM - 12:00 PM)',
        promoCode: `GLOW-${slowestDayName.toUpperCase()}-15`
      };

      return {
        status: 'success',
        providerId: parsedProviderId,
        insights: {
          slowestDay: slowestDayName,
          slowestDayBookingsMonth: totalBookingsSlowDay,
          recommendation: `Tu día con menor ocupación es el ${slowestDayName}. VALKYRIE autoriza una promoción del ${discountPercentage}% para llenar horas muertas de la mañana.`,
          dynamicPromotion: dynamicPromo
        }
      };
    } catch (err) {
      console.error('❌ [VALKYRIE Agent] Error generando insights B2B:', err.message);
      return { status: 'error', message: err.message };
    }
  }
}

module.exports = new ValkyrieAgent();

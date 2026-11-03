// backend/src/services/agents/hestiaAgent.js
const { pool } = require('../../config/db');
const atenaAgent = require('./atenaAgent');

/**
 * AGENTE HESTIA: Personal Shopper y Recomendadora de Productos en GlowStore (E-Commerce)
 */
class HestiaAgent {
  /**
   * Recomienda productos de la tienda GlowStore compatibles con el perfil del usuario o término de búsqueda
   * @param {Object} params - { userId, queryText, category }
   * @returns {Promise<Object>} Productos recomendados
   */
  async recommendProducts({ userId, queryText, category }) {
    try {
      let targetIngredients = [];

      // 1. Si hay userId, consultar perfil biométrico con ATENA para extraer ingredientes sugeridos
      if (userId) {
        const atenaDiagnosis = await atenaAgent.getBiometricDiagnosis(userId);
        if (atenaDiagnosis && atenaDiagnosis.recommendedIngredients) {
          targetIngredients = atenaDiagnosis.recommendedIngredients;
        }
      }

      // 2. Construir consulta a la tabla productos
      // La tienda en el cliente (store_screen.dart, store_product_card.dart) consume la columna 'precio' como tarifa principal.
      let query = `
        SELECT id, nombre, descripcion, precio, tag_especialidad AS categoria, stock, imagen_url
        FROM productos
        WHERE stock > 0
      `;
      const params = [];

      if (category) {
        query += ` AND LOWER(tag_especialidad) LIKE $1`;
        params.push(`%${category.toLowerCase()}%`);
      } else if (queryText) {
        query += ` AND (LOWER(nombre) LIKE $1 OR LOWER(descripcion) LIKE $1)`;
        params.push(`%${queryText.toLowerCase()}%`);
      }

      query += ` ORDER BY precio ASC LIMIT 4;`;

      let dbRows = [];
      try {
        const res = await pool.query(query, params);
        if (res && res.rows) {
          dbRows = res.rows;
        }
      } catch (dbErr) {
        console.warn('⚠️ [HESTIA Agent] Fallo al consultar BD productos:', dbErr.message);
        return { status: 'error', message: `Fallo al consultar productos: ${dbErr.message}` };
      }

      // Si la BD devuelve productos
      if (dbRows.length > 0) {
        return {
          status: 'success',
          foundCount: dbRows.length,
          matchedIngredients: targetIngredients,
          products: dbRows
        };
      }

      // Sin fabricación de productos ficticios: respuesta honesta cuando no hay resultados
      return {
        status: 'no_products',
        foundCount: 0,
        matchedIngredients: targetIngredients,
        products: [],
        message: 'No se encontraron productos coincidentes en la tienda.'
      };
    } catch (err) {
      console.error('❌ [HESTIA Agent] Error en recomendación de productos:', err.message);
      return { status: 'error', message: err.message };
    }
  }
}

module.exports = new HestiaAgent();

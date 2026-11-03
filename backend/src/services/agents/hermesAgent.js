// backend/src/services/agents/hermesAgent.js
const { pool } = require('../../config/db');
const { ESTADOS_QUE_OCUPAN_AGENDA } = require('./bookingStateConstants');

/**
 * AGENTE HERMES: Especialista en Logística, Agendamiento Inteligente y Geometría PostGIS
 */
class HermesAgent {
  /**
   * Busca los prestadores y servicios más cercanos usando geolocalización PostGIS
   * @param {Object} params - { latitude, longitude, category, maxDistanceKm }
   * @returns {Promise<Object>} Resultado de la búsqueda espacial con distancia calculada
   */
  async findNearbyServices({ latitude, longitude, category, maxDistanceKm = 5 }) {
    const lat = parseFloat(latitude) || 4.6097;  // Bogotá centro por defecto
    const lon = parseFloat(longitude) || -74.0817;
    const radiusKm = parseFloat(maxDistanceKm) || 5;

    let query = `
      SELECT s.id as service_id, s.name, s.price, s.duration_minutes, s.tag_especialidad as category, 
             p.id as provider_id, p.business_name, p.rating_avg,
             ROUND((ST_Distance(p.ubicacion, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) / 1000.0)::numeric, 2) as distance_km
      FROM services s
      JOIN perfiles_prestador p ON s.provider_id = p.id
      WHERE s.is_active = true AND p.is_active = true
    `;

    const params = [lat, lon, radiusKm];

    if (category) {
      query += ` AND (LOWER(s.tag_especialidad) LIKE $4 OR LOWER(s.name) LIKE $4)`;
      params.push(`%${category.toLowerCase()}%`);
    }

    query += ` AND ST_DWithin(p.ubicacion, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3 * 1000)`;
    query += ` ORDER BY distance_km ASC, p.rating_avg DESC LIMIT 5;`;

    try {
      const res = await pool.query(query, params);
      return {
        status: 'success',
        foundCount: res.rows.length,
        searchOrigin: { latitude: lat, longitude: lon, radiusKm },
        services: res.rows
      };
    } catch (err) {
      console.error('❌ [HERMES Agent] Error en consulta PostGIS:', err.message);
      return { status: 'error', message: `Fallo al buscar prestadores: ${err.message}` };
    }
  }

  /**
   * Verifica la disponibilidad de agenda de un prestador evitando colisiones de citas
   * @param {Object} params - { providerId, serviceId, date }
   * @returns {Promise<Object>} Análisis de agenda y slots ocupados/libres
   */
  async checkAvailability({ providerId, serviceId, date }) {
    const parsedProviderId = parseInt(providerId, 10);
    if (isNaN(parsedProviderId)) {
      return { status: 'error', message: 'providerId inválido' };
    }
    const targetDate = date || new Date().toISOString().split('T')[0];

    const query = `
      SELECT b.id, b.scheduled_at, s.duration_minutes, b.estado 
      FROM bookings b
      JOIN services s ON b.service_id = s.id
      WHERE b.provider_id = $1 
        AND b.scheduled_at::date = $2::date 
        AND b.estado = ANY($3::varchar[]);
    `;

    try {
      const res = await pool.query(query, [parsedProviderId, targetDate, ESTADOS_QUE_OCUPAN_AGENDA]);
      const occupiedSlots = res.rows.map(r => ({
        bookingId: r.id,
        startTime: r.scheduled_at,
        status: r.estado
      }));

      return {
        status: 'success',
        providerId: parsedProviderId,
        date: targetDate,
        totalOccupied: occupiedSlots.length,
        occupiedSlots,
        message: occupiedSlots.length > 0 
          ? `El prestador tiene ${occupiedSlots.length} citas agendadas el ${targetDate}.` 
          : `El prestador tiene disponibilidad completa para el ${targetDate}.`
      };
    } catch (err) {
      console.error('❌ [HERMES Agent] Error verificando agenda:', err.message);
      return { status: 'error', message: `Fallo al verificar agenda: ${err.message}` };
    }
  }
}

module.exports = new HermesAgent();

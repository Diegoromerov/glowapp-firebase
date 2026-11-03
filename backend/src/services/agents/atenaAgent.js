// backend/src/services/agents/atenaAgent.js
const { pool } = require('../../config/db');
const redisClient = require('../../config/redis');

const biometricCryptoService = require('../biometricCryptoService');

/**
 * AGENTE ATENA: Especialista en Biometría, Visajismo, Diagnóstico Cutáneo/Capilar y Colorimetría
 */
class AtenaAgent {
  /**
   * Obtiene y evalúa el perfil biométrico de un usuario desde Redis (caché) o PostgreSQL
   * @param {number} userId - ID del usuario
   * @returns {Promise<Object>} Análisis biométrico profundo
   */
  async getBiometricDiagnosis(userId) {
    const parsedUserId = parseInt(userId, 10);
    if (isNaN(parsedUserId)) {
      return { status: 'error', message: 'userId inválido' };
    }
    const cacheKey = `beauty:profile:${parsedUserId}`;
    
    // 1. Intentar consultar desde el caché de Redis (30d TTL)
    try {
      if (redisClient && redisClient.isOpen) {
        const cachedData = await redisClient.get(cacheKey);
        if (cachedData) {
          console.log(`⚡ [ATENA Agent] Perfil biométrico obtenido de Redis cache (userId: ${parsedUserId})`);
          return JSON.parse(cachedData);
        }
      }
    } catch (cacheErr) {
      console.warn('⚠️ [ATENA Agent] Fallo al consultar Redis:', cacheErr.message);
    }

    // 2. Si hay miss en Redis, consultar PostgreSQL
    const query = `
      SELECT id, user_id, face_scores, hands_diagnosis, recommendation, created_at 
      FROM beauty_profiles 
      WHERE user_id = $1 
      ORDER BY created_at DESC 
      LIMIT 1;
    `;
    const res = await pool.query(query, [parsedUserId]);

    if (res.rows.length === 0) {
      return {
        status: 'no_profile_found',
        message: 'El usuario no tiene un diagnóstico biométrico registrado en la plataforma.'
      };
    }

    const rawProfile = res.rows[0];

    // Descifrar campos biométricos antes de enriquecer el diagnóstico
    const faceScores = biometricCryptoService.decrypt(rawProfile.face_scores);
    const handsDiagnosis = biometricCryptoService.decrypt(rawProfile.hands_diagnosis);

    const decryptedProfile = {
      ...rawProfile,
      face_scores: faceScores,
      hands_diagnosis: handsDiagnosis
    };

    const diagnosis = this.enrichDiagnosis(decryptedProfile);

    // 3. Poblar el caché de Redis
    try {
      if (redisClient && redisClient.isOpen) {
        if (typeof redisClient.setEx === 'function') {
          await redisClient.setEx(cacheKey, 2592000, JSON.stringify(diagnosis)); // 30 días TTL
        } else if (typeof redisClient.set === 'function') {
          await redisClient.set(cacheKey, JSON.stringify(diagnosis), { EX: 2592000 });
        }
      }
    } catch (cacheSetErr) {
      console.warn('⚠️ [ATENA Agent] Error guardando en Redis:', cacheSetErr.message);
    }

    return diagnosis;
  }

  /**
   * Enriquece los datos raw con recomendaciones estéticas y de ingredientes activos
   */
  enrichDiagnosis(rawProfile) {
    const face = rawProfile.face_scores || {};
    const hands = rawProfile.hands_diagnosis || {};
    const subtono = face.subtono || 'neutro';

    // Determinar paleta de colorimetría recomendada
    let colorPalette = ['Nude Clásico', 'Rosa Palo', 'Vino Tinto'];
    if (subtono === 'frio' || subtono === 'frío') {
      colorPalette = ['Plateado', 'Rosa Pastel', 'Rojo Rubí', 'Azul Real'];
    } else if (subtono === 'calido' || subtono === 'cálido') {
      colorPalette = ['Dorado', 'Terracota', 'Verde Olivo', 'Beige Cálido'];
    }

    // Sugerencia de ingredientes según scores
    const recommendedIngredients = [];
    if (face.hydration < 60) recommendedIngredients.push('Ácido Hialurónico', 'Ceramidas');
    if (face.pores > 40) recommendedIngredients.push('Niacinamida 10%', 'Ácido Salicílico');
    if (face.wrinkles > 30) recommendedIngredients.push('Retinol', 'Péptidos');

    return {
      status: 'success',
      profileId: rawProfile.id,
      userId: rawProfile.user_id,
      faceScores: face,
      handsDiagnosis: hands,
      skinSubtone: subtono,
      recommendedColorPalette: colorPalette,
      recommendedIngredients: Array.from(new Set(recommendedIngredients)),
      recommendationText: rawProfile.recommendation,
      createdAt: rawProfile.created_at
    };
  }
}

module.exports = new AtenaAgent();

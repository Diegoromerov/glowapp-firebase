// backend/src/services/biometric/profile.service.js
const { pool } = require('../../config/db');
const redisClient = require('../../config/redis');
const biometricCryptoService = require('../biometricCryptoService');

const PROFILE_TTL = 30 * 24 * 60 * 60; // 30 días en segundos

class ProfileService {
  /**
   * Guarda o actualiza un perfil biométrico con cifrado en reposo (AES-256-GCM / ADR-001)
   */
  async saveProfile(profileData) {
    const {
      userId,
      faceScores,
      handsDiagnosis,
      recommendation,
      recommendedProducts = [],
      entryPoint = 'ideas',
      keyIngredients = [],
    } = profileData;

    // Cifrar datos biométricos sensibles antes de almacenar en BD
    const encryptedFaceScores = biometricCryptoService.encrypt(faceScores);
    const encryptedHandsDiagnosis = biometricCryptoService.encrypt(handsDiagnosis);
    
    // Para columnas de tipo JSONB, se envuelve la cadena cifrada en un literal de cadena JSON validado por PostgreSQL (evita error 22P02)
    const jsonFaceScores = encryptedFaceScores ? JSON.stringify(encryptedFaceScores) : null;
    const jsonHandsDiagnosis = encryptedHandsDiagnosis ? JSON.stringify(encryptedHandsDiagnosis) : null;
    const recommendedProductsStr = JSON.stringify(recommendedProducts);

    // Transacción atómica en PostgreSQL (perfil e historial)
    const client = await pool.connect();
    let profile;

    try {
      await client.query('BEGIN');

      const upsertQuery = `
        INSERT INTO beauty_profiles (user_id, face_scores, hands_diagnosis, recommendation, recommended_products, entry_point, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET
          face_scores = EXCLUDED.face_scores,
          hands_diagnosis = EXCLUDED.hands_diagnosis,
          recommendation = EXCLUDED.recommendation,
          recommended_products = EXCLUDED.recommended_products,
          entry_point = EXCLUDED.entry_point,
          updated_at = NOW()
        RETURNING *;
      `;

      const upsertRes = await client.query(upsertQuery, [
        userId,
        jsonFaceScores,
        jsonHandsDiagnosis,
        recommendation,
        recommendedProductsStr,
        entryPoint,
      ]);

      profile = upsertRes.rows[0];
      const validProfileId = profile && profile.id ? profile.id.toString() : null;

      const historyQuery = `
        INSERT INTO biometric_history (user_id, profile_id, face_scores, hands_diagnosis, recommendation)
        VALUES ($1, $2, $3, $4, $5);
      `;
      await client.query(historyQuery, [
        userId,
        validProfileId,
        jsonFaceScores,
        jsonHandsDiagnosis,
        recommendation,
      ]);

      await client.query('COMMIT');
    } catch (txErr) {
      let rollbackErr = null;
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {
        rollbackErr = rbErr;
        console.error('🚨 [CRITICAL AUDIT ERROR] Fallo al ejecutar ROLLBACK en PostgreSQL:', rbErr.message);
      }
      console.error('🚨 [CRITICAL AUDIT ERROR] No se pudo guardar perfil/historial biométrico:', txErr.message);
      if (rollbackErr && typeof client.release === 'function') {
        try { client.release(rollbackErr); } catch (_) {}
      }
      throw new Error(`Fallo crítico al registrar historial biométrico: ${txErr.message}`);
    } finally {
      try { client.release(); } catch (_) {}
    }

    // Cachear objeto des-cifrado en Redis
    const cacheData = {
      id: profile.id,
      userId: profile.user_id,
      faceScores,
      handsDiagnosis,
      recommendation,
      recommendedProducts,
      entryPoint,
      keyIngredients,
      createdAt: profile.created_at,
      updatedAt: profile.updated_at,
    };

    try {
      await redisClient.setEx(
        `beauty:profile:${userId}`,
        PROFILE_TTL,
        JSON.stringify(cacheData)
      );
    } catch (err) {
      console.warn('⚠️  No se pudo escribir en la caché de Redis:', err.message);
    }

    return cacheData;
  }

  /**
   * Obtiene el perfil de un usuario (descifrando de BD si es necesario)
   */
  async getProfile(userId) {
    try {
      const cached = await redisClient.get(`beauty:profile:${userId}`);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      console.warn('⚠️  No se pudo leer de la caché de Redis:', err.message);
    }

    const selectQuery = `
      SELECT * FROM beauty_profiles
      WHERE user_id = $1;
    `;
    const res = await pool.query(selectQuery, [userId]);
    if (res.rows.length === 0) return null;

    const profile = res.rows[0];

    // Descifrar campos sensibles
    const faceScores = biometricCryptoService.decrypt(profile.face_scores);
    const handsDiagnosis = biometricCryptoService.decrypt(profile.hands_diagnosis);

    const recommendedProducts = typeof profile.recommended_products === 'string'
      ? JSON.parse(profile.recommended_products)
      : profile.recommended_products;

    const result = {
      id: profile.id,
      userId: profile.user_id,
      faceScores,
      handsDiagnosis,
      recommendation: profile.recommendation,
      recommendedProducts,
      entryPoint: profile.entry_point,
      createdAt: profile.created_at,
      updatedAt: profile.updated_at,
    };

    try {
      await redisClient.setEx(
        `beauty:profile:${userId}`,
        PROFILE_TTL,
        JSON.stringify(result)
      );
    } catch (err) {
      console.warn('⚠️  No se pudo repoblar la caché de Redis:', err.message);
    }

    return result;
  }

  /**
   * Elimina el perfil (Derecho al Olvido / Habeas Data)
   */
  async deleteProfile(userId) {
    await pool.query('DELETE FROM beauty_profiles WHERE user_id = $1', [userId]);
    try {
      await redisClient.del(`beauty:profile:${userId}`);
    } catch (err) {
      console.warn('⚠️  Error al borrar caché de Redis:', err.message);
    }
    return true;
  }
}

module.exports = new ProfileService();

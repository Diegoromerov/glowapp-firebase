/**
 * backend/src/services/consentService.js
 * Servicio de gestión de consentimientos biométricos
 * Cumple Ley 1581/2012: derechos de acceso, actualización, rectificación, supresión
 */

const { pool } = require('../config/db');
const { getRedisClient } = require('../middleware/rateLimiter');
const { BIOMETRIC_CONSENT_VERSION, isSupportedConsentVersion } = require('../config/consentConfig');

/**
 * Tipos de consentimiento válidos
 */
const VALID_CONSENT_TYPES = [
  'facial_analysis',
  'skin_scan', 
  'hair_analysis',
  'body_measurement',
  'virtual_try_on',
  'all_biometric'
];

/**
 * Cache TTL en milisegundos (5 minutos)
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Genera clave de cache para consentimiento
 */
function getCacheKey(userId, consentType) {
  return `consent:${userId}:${consentType}`;
}

/**
 * Verifica consentimiento de un usuario para un tipo específico
 * Busca en Redis primero, luego PostgreSQL
 * 
 * @param {string} userId - UUID del usuario
 * @param {string} consentType - Tipo de consentimiento
 * @returns {Promise<Object>} { granted: boolean, grantedAt: Date|null, version: string|null }
 */
async function checkConsent(userId, consentType) {
  try {
    // Validar tipo
    if (!VALID_CONSENT_TYPES.includes(consentType)) {
      return { granted: false, grantedAt: null, version: null };
    }

    // Intentar Redis primero
    const redis = await getRedisClient();
    const cacheKey = `consent:${userId}:${consentType}`;
    
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      } catch (error) {
        console.warn('⚠️ Redis cache error, usando DB:', error.message);
      }
    }

    // Consultar PostgreSQL
    const query = `
      SELECT granted, granted_at, version_terms, revoked_at
      FROM biometric_consents
      WHERE user_id = $1 AND consent_type = $2
      ORDER BY version_terms DESC
      LIMIT 1
    `;
    
    const res = await pool.query(query, [userId, consentType]);
    
    let result;
    
    if (res.rows.length === 0) {
      result = { granted: false, grantedAt: null, version: null };
    } else {
      const consent = res.rows[0];
      
      if (!consent.granted || consent.revoked_at) {
        result = { granted: false, grantedAt: null, version: consent.version_terms };
      } else {
        result = { 
          granted: true, 
          grantedAt: consent.granted_at, 
          version: consent.version_terms 
        };
      }
    }
    
    // Cachear resultado
    if (redis) {
      try {
        await redis.setEx(cacheKey, 300, JSON.stringify(result)); // 5 min TTL
      } catch (error) {
        console.warn('⚠️ Error guardando cache consentimiento:', error.message);
      }
    }
    
    return result;
    
  } catch (error) {
    console.error('❌ Error verificando consentimiento:', error.message);
    // Fail closed por seguridad legal
    return { granted: false, grantedAt: null, version: null };
  }
}

/**
 * Otorga consentimiento biométrico
 * 
 * @param {Object} params - { userId, consentType, purpose, ipAddress, userAgent, versionTerms }
 * @returns {Promise<Object>} Registro de consentimiento creado/actualizado
 */
async function grantConsent({ userId, consentType, purpose, ipAddress, userAgent, versionTerms = BIOMETRIC_CONSENT_VERSION }) {
  try {
    // Validar tipo
    if (!VALID_CONSENT_TYPES.includes(consentType)) {
      throw new Error(`Tipo de consentimiento inválido: ${consentType}`);
    }

    // Y-F1b: solo se registra una versión del texto que el backend conozca.
    if (!isSupportedConsentVersion(versionTerms)) {
      throw new Error(`Versión de consentimiento no soportada: ${versionTerms}`);
    }
    
    // Validar purpose (requerido por Ley 1581 Art. 12)
    if (!purpose || purpose.trim().length < 10) {
      throw new Error('La finalidad (purpose) es requerida y debe tener al menos 10 caracteres');
    }
    
    const query = `
      INSERT INTO biometric_consents 
      (user_id, consent_type, granted, granted_at, purpose, ip_address, user_agent, version_terms)
      VALUES ($1, $2, TRUE, NOW(), $3, $4, $5, $6)
      ON CONFLICT (user_id, consent_type, version_terms) 
      DO UPDATE SET 
        granted = TRUE,
        granted_at = NOW(),
        revoked_at = NULL,
        purpose = EXCLUDED.purpose,
        ip_address = EXCLUDED.ip_address,
        user_agent = EXCLUDED.user_agent,
        updated_at = NOW()
      RETURNING *
    `;
    
    const res = await pool.query(query, [
      userId, 
      consentType, 
      purpose.trim(), 
      ipAddress || null, 
      userAgent || null, 
      versionTerms
    ]);
    
    const consent = res.rows[0];
    
    // Invalidar cache
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cacheKey = `consent:${userId}:${consentType}`;
        await redis.del(cacheKey);
      } catch (error) {
        console.warn('⚠️ Error invalidando cache:', error.message);
      }
    }
    
    // Log en auditoría
    await logAccess({
      userId,
      accessedBy: 'user_self',
      accessType: 'grant_consent',
      consentId: consent.id,
      ip: ipAddress,
      details: { consentType, purpose, versionTerms }
    });
    
    return consent;
    
  } catch (error) {
    console.error('❌ Error otorgando consentimiento:', error.message);
    throw error;
  }
}

/**
 * Revoca consentimiento biométrico
 * 
 * @param {string} userId - UUID del usuario
 * @param {string} consentType - Tipo de consentimiento a revocar (o 'all_biometric' para todos)
 * @returns {Promise<boolean>} true si se revocó al menos uno
 */
async function revokeConsent(userId, consentType) {
  try {
    let query, params;
    
    if (consentType === 'all_biometric') {
      // Revocar TODOS los tipos
      query = `
        UPDATE biometric_consents
        SET granted = FALSE, revoked_at = NOW(), updated_at = NOW()
        WHERE user_id = $1 AND granted = TRUE
        RETURNING *
      `;
      params = [userId];
    } else {
      // Revocar tipo específico
      if (!VALID_CONSENT_TYPES.includes(consentType)) {
        throw new Error(`Tipo de consentimiento inválido: ${consentType}`);
      }
      
      query = `
        UPDATE biometric_consents
        SET granted = FALSE, revoked_at = NOW(), updated_at = NOW()
        WHERE user_id = $1 AND consent_type = $2 AND granted = TRUE
        RETURNING *
      `;
      params = [userId, consentType];
    }
    
    const res = await pool.query(query, params);

    if (res.rows.length === 0) {
      return false;
    }

    // Invalidar cache
    const redis = await getRedisClient();
    if (redis) {
      try {
        if (consentType === 'all_biometric') {
          // Invalidar todos los caches del usuario
          const keys = await redis.keys(`consent:${userId}:*`);
          if (keys.length > 0) {
            await redis.del(...keys);
          }
        } else {
          const cacheKey = `consent:${userId}:${consentType}`;
          await redis.del(cacheKey);
        }
      } catch (error) {
        console.warn('⚠️ Error invalidando cache:', error.message);
      }
    }

    if (consentType === 'all_biometric') {
      const redisClient = await getRedisClient();
      if (redisClient) await redisClient.del(`beauty:profile:${userId}`);
    }

    if (redis) {
      try {
        if (consentType === 'all_biometric') {
          const keys = await redis.keys(`consent:${userId}:*`);
          if (keys.length) await redis.del(...keys);
        } else {
          await redis.del(getCacheKey(userId, consentType));
        }
      } catch (error) {
        console.warn('⚠️ Error invalidando caché de consentimiento:', error.message);
      }
    }

    // Log en auditoría
    await logAccess({
      userId,
      accessedBy: 'user_self',
      accessType: 'revoke_consent',
      ip: null,
      details: { consentType }
    });
    
    return res.rows.length > 0;
    
  } catch (error) {
    console.error('❌ Error revocando consentimiento:', error.message);
    throw error;
  }
}

/**
 * Obtiene historial de consentimientos del usuario
 * Para cumplir con derecho de acceso (Art. 8 Ley 1581)
 * 
 * @param {string} userId - UUID del usuario
 * @returns {Promise<Array>} Historial de consentimientos
 */
async function getConsentHistory(userId) {
  try {
    const query = `
      SELECT 
        id, consent_type, granted, granted_at, revoked_at, 
        purpose, ip_address, user_agent, version_terms, 
        created_at, updated_at
      FROM biometric_consents
      WHERE user_id = $1
      ORDER BY consent_type, created_at DESC
    `;
    
    const res = await pool.query(query, [userId]);
    return res.rows;
    
  } catch (error) {
    console.error('❌ Error obteniendo historial de consentimientos:', error.message);
    return [];
  }
}

/**
 * Elimina todos los datos biométricos del usuario
 * Para cumplir con derecho de supresión (Art. 8 Ley 1581)
 * Mantiene registro de consentimiento revocado (auditoría legal)
 * 
 * @param {string} userId - UUID del usuario
 * @returns {Promise<Object>} { deleted: boolean, recordsAffected: number }
 */
async function deleteBiometricData(userId) {
  try {
    let recordsAffected = 0;
    const tables = [
      // T-111: las comparaciones antes que las sesiones (cuelgan de ellas), y ambas
      // antes que el resto. Antes faltaban: cerrar la cuenta borraba la foto y el
      // perfil, pero dejaba intactos los escaneos cifrados y su huella — el mensaje
      // «tus datos han sido eliminados» era falso justo en lo biométrico.
      'biometric_scan_comparisons', 'biometric_scan_sessions',
      'user_photos', 'biometric_history', 'beauty_profiles',
      'user_biometrics', 'ai_diagnostics', 'skin_profiles',
    ];
    const client = typeof pool.connect === 'function' ? await pool.connect() : null;
    const queryable = client || pool;
    if (client) await client.query('BEGIN');
    try {
    for (const table of tables) {
      const result = await queryable.query(`DELETE FROM ${table} WHERE user_id = $1`, [table === 'user_biometrics' ? String(userId) : userId]);
      recordsAffected += result.rowCount;
    }
      if (client) await client.query('COMMIT');
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      throw error;
    } finally {
      if (client) client.release();
    }

    const redis = await getRedisClient();
    if (redis) await redis.del(`beauty:profile:${userId}`);
    // 9. Log en auditoría (NO eliminar consentimientos revocados - auditoría legal)
    await logAccess({
      userId,
      accessedBy: 'user_self',
      accessType: 'delete_data',
      ip: null,
      details: { recordsAffected, tables: ['biometric_scan_comparisons', 'biometric_scan_sessions', 'user_photos', 'biometric_history', 'beauty_profiles', 'user_biometrics', 'ai_diagnostics', 'skin_profiles'] }
    });

    return { deleted: true, recordsAffected };

  } catch (error) {
    console.error('❌ Error eliminando datos biométricos:', error.message);
    return { deleted: false, recordsAffected: 0, error: error.message };
  }
}

/**
 * Wrapper que verifica consentimiento ANTES de ejecutar cualquier función
 * 
 * @param {string} userId - UUID del usuario
 * @param {string} consentType - Tipo de consentimiento requerido
 * @param {Function} processingFunction - Función a ejecutar si hay consentimiento
 * @returns {Promise<any>} Resultado de la función de procesamiento
 * @throws {Error} 403 si no hay consentimiento
 */
async function validateConsentBeforeProcessing(userId, consentType, processingFunction) {
  const consent = await checkConsent(userId, consentType);
  
  if (!consent.granted) {
    const error = new Error('Consentimiento biométrico requerido');
    error.statusCode = 403;
    error.code = 'CONSENT_REQUIRED';
    error.consentType = consentType;
    error.message = `Para usar esta función, necesitas otorgar consentimiento para el procesamiento de tus datos biométricos (${consentType}). Puedes hacerlo en Configuración > Privacidad > Datos Biométricos.`;
    throw error;
  }
  
  // Log acceso antes de procesar
  await logAccess({
    userId,
    accessedBy: 'system',
    accessType: `process_${consentType}`,
    ip: null,
    details: { consentType }
  });
  
  return await processingFunction();
}

/**
 * Registra acceso a datos biométricos en tabla de auditoría
 * 
 * @param {Object} params - { userId, accessedBy, accessType, consentId, ip, details }
 * @returns {Promise<void>}
 */
async function logAccess({ userId, accessedBy, accessType, consentId = null, ip = null, details = {} }) {
  try {
    const query = `
      INSERT INTO biometric_access_log 
      (user_id, accessed_by, access_type, consent_id, ip_address, details)
      VALUES ($1, $2, $3, $4, $5, $6)
    `;
    
    await pool.query(query, [
      userId,
      accessedBy,
      accessType,
      consentId,
      ip,
      JSON.stringify(details)
    ]);
  } catch (error) {
    console.error('❌ Error logging biometric access:', error.message);
    // No fallar el request principal por error de auditoría
  }
}

/**
 * Valida que un tipo de consentimiento es válido
 */
function isValidConsentType(consentType) {
  return VALID_CONSENT_TYPES.includes(consentType);
}

module.exports = {
  checkConsent,
  grantConsent,
  revokeConsent,
  getConsentHistory,
  deleteBiometricData,
  validateConsentBeforeProcessing,
  logAccess,
  isValidConsentType,
  VALID_CONSENT_TYPES
};

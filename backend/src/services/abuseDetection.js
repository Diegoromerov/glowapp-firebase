/**
 * backend/src/services/abuseDetection.js
 * Detección de patrones de abuso para rate limiting
 * Bloqueo temporal (max 24h), nunca permanente
 */

const Redis = require('redis');

/**
 * Cliente Redis singleton
 */
let redisClient = null;
let redisConnected = false;

async function getRedisClient() {
  if (redisClient && redisConnected) return redisClient;
  
  try {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    redisClient = Redis.createClient({ url: redisUrl });
    
    redisClient.on('error', (err) => {
      console.error('❌ Redis abuse detection error:', err.message);
      redisConnected = false;
    });
    
    redisClient.on('connect', () => {
      redisConnected = true;
    });
    
    await redisClient.connect();
    return redisClient;
  } catch (error) {
    console.warn('⚠️ Redis no disponible para abuse detection:', error.message);
    redisConnected = false;
    return null;
  }
}

/**
 * Configuración de umbrales de abuso
 */
const ABUSE_THRESHOLDS = {
  // Rate limit excedidos en 10 minutos
  suspiciousLimit: 5,      // Marcar como sospechoso
  blockLimit: 10,          // Bloqueo temporal
  
  // Ventanas de tiempo
  windowMs: 10 * 60 * 1000, // 10 minutos
  blockDurationMs: 30 * 60 * 1000, // 30 minutos bloqueo
  maxBlockDurationMs: 24 * 60 * 60 * 1000, // 24 horas máximo
  
  // Otros patrones
  maxPayloadSize: 10 * 1024, // 10KB
  minRequestInterval: 1000,  // 1 segundo entre requests
};

/**
 * Claves Redis para abuse detection
 */
const ABUSE_KEYS = {
  rateLimitEvents: (userId) => `abuse:rate_limit_events:${userId}`,
  block: (userId) => `abuse:block:${userId}`,
  suspicious: (userId) => `abuse:suspicious:${userId}`,
  requestTimes: (userId) => `abuse:request_times:${userId}`,
  payloadSizes: (userId) => `abuse:payload_sizes:${userId}`,
};

/**
 * Registra un evento de abuso para un usuario
 * @param {string} userId - ID del usuario
 * @param {string} eventType - Tipo de evento: 'rate_limit_exceeded', 'large_payload', 'fast_requests'
 * @param {Object} metadata - Metadatos adicionales
 * @returns {Promise<{ suspicious: boolean, blocked: boolean, blockUntil: Date|null }>}
 */
async function trackAbuse(userId, eventType, metadata = {}) {
  if (!userId) return { suspicious: false, blocked: false, blockUntil: null };
  
  try {
    const redis = await getRedisClient();
    if (!redis) return { suspicious: false, blocked: false, blockUntil: null };
    
    const now = Date.now();
    const windowStart = now - ABUSE_THRESHOLDS.windowMs;
    const eventsKey = ABUSE_KEYS.rateLimitEvents(userId);
    const blockKey = ABUSE_KEYS.block(userId);
    const suspiciousKey = ABUSE_KEYS.suspicious(userId);
    
    // Verificar si ya está bloqueado
    const existingBlock = await redis.get(blockKey);
    if (existingBlock) {
      const blockUntil = new Date(parseInt(existingBlock));
      return { suspicious: true, blocked: true, blockUntil };
    }
    
    // Pipeline atómico para registrar evento
    const pipeline = redis.multi();
    
    // Añadir evento con timestamp
    const eventData = JSON.stringify({
      type: eventType,
      timestamp: now,
      metadata,
    });
    
    pipeline.zAdd(eventsKey, { score: now, value: eventData });
    pipeline.expire(eventsKey, Math.ceil(ABUSE_THRESHOLDS.windowMs / 1000) + 60);
    
    // También trackear en contador simple para acceso rápido
    pipeline.incr(`${eventsKey}:count`);
    pipeline.expire(`${eventsKey}:count`, Math.ceil(ABUSE_THRESHOLDS.windowMs / 1000) + 60);
    
    await pipeline.exec();
    
    // Obtener conteo actual
    const count = await redis.zCard(eventsKey);
    
    let suspicious = false;
    let blocked = false;
    let blockUntil = null;
    
    if (count >= ABUSE_THRESHOLDS.blockLimit) {
      // Bloquear usuario
      blocked = true;
      blockUntil = new Date(now + ABUSE_THRESHOLDS.blockDurationMs);
      await redis.set(blockKey, blockUntil.getTime().toString());
      await redis.expire(blockKey, Math.ceil(ABUSE_THRESHOLDS.blockDurationMs / 1000) + 60);
      
      console.warn(`🚫 Usuario BLOQUEADO temporalmente: ${userId} - Eventos: ${count} (${eventType})`);
    } else if (count >= ABUSE_THRESHOLDS.suspiciousLimit) {
      // Marcar como sospechoso
      suspicious = true;
      await redis.set(suspiciousKey, '1');
      await redis.expire(suspiciousKey, Math.ceil(ABUSE_THRESHOLDS.windowMs / 1000) + 60);
      
      console.warn(`⚠️ Usuario SOSPECHOSO: ${userId} - Eventos: ${count} (${eventType})`);
    }
    
    return { suspicious, blocked, blockUntil };
  } catch (error) {
    console.error('❌ Error en trackAbuse:', error.message);
    return { suspicious: false, blocked: false, blockUntil: null };
  }
}

/**
 * Verifica si un usuario está bloqueado
 * @param {string} userId - ID del usuario
 * @returns {Promise<{ blocked: boolean, blockUntil: Date|null }>}
 */
async function isBlocked(userId) {
  if (!userId) return { blocked: false, blockUntil: null };
  
  try {
    const redis = await getRedisClient();
    if (!redis) return { blocked: false, blockUntil: null };
    
    const blockKey = ABUSE_KEYS.block(userId);
    const blockTime = await redis.get(blockKey);
    
    if (blockTime) {
      const until = new Date(parseInt(blockTime));
      if (until > new Date()) {
        return { blocked: true, blockUntil: until };
      } else {
        // Bloqueo expirado, limpiar
        await redis.del(blockKey);
        return { blocked: false, blockUntil: null };
      }
    }
    
    return { blocked: false, blockUntil: null };
  } catch (error) {
    console.error('❌ Error en isBlocked:', error.message);
    return { blocked: false, blockUntil: null };
  }
}

/**
 * Obtiene reporte de abuso para un usuario
 * @param {string} userId - ID del usuario
 * @returns {Promise<Object>} Reporte de actividad sospechosa
 */
async function getAbuseReport(userId) {
  if (!userId) return { events: [], counts: {}, totalEvents: 0, suspicious: false, blocked: false, blockUntil: null, windowMs: ABUSE_THRESHOLDS.windowMs };
  
  try {
    const redis = await getRedisClient();
    if (!redis) return { events: [], counts: {}, suspicious: false, blocked: false };
    
    const eventsKey = ABUSE_KEYS.rateLimitEvents(userId);
    const blockKey = ABUSE_KEYS.block(userId);
    const suspiciousKey = ABUSE_KEYS.suspicious(userId);
    
    // Obtener eventos recientes
    const now = Date.now();
    const windowStart = now - ABUSE_THRESHOLDS.windowMs;
    
    const events = await redis.zRangeByScore(eventsKey, windowStart, '+inf');
    const parsedEvents = events.map(e => {
      try {
        return JSON.parse(e);
      } catch {
        return { raw: e };
      }
    });
    
    // Contar por tipo
    const counts = {};
    for (const event of parsedEvents) {
      if (event.type) {
        counts[event.type] = (counts[event.type] || 0) + 1;
      }
    }
    
    // Verificar bloqueo
    const blockTime = await redis.get(blockKey);
    const blocked = !!blockTime;
    const blockUntil = blockTime ? new Date(parseInt(blockTime)) : null;
    
    // Verificar sospechoso
    const suspicious = await redis.exists(suspiciousKey);
    
    return {
      events: parsedEvents,
      counts,
      totalEvents: parsedEvents.length,
      suspicious: suspicious === 1,
      blocked,
      blockUntil,
      windowMs: ABUSE_THRESHOLDS.windowMs,
    };
  } catch (error) {
    console.error('❌ Error en getAbuseReport:', error.message);
    return { events: [], counts: {}, suspicious: false, blocked: false, error: error.message };
  }
}

/**
 * Trackea tamaño de payload sospechoso
 * @param {string} userId - ID del usuario
 * @param {number} payloadSize - Tamaño en bytes
 * @returns {Promise<void>}
 */
async function trackLargePayload(userId, payloadSize) {
  if (!userId || payloadSize <= ABUSE_THRESHOLDS.maxPayloadSize) return;
  
  await trackAbuse(userId, 'large_payload', { size: payloadSize });
}

/**
 * Trackea requests muy rápidos (posible bot)
 * @param {string} userId - ID del usuario
 * @returns {Promise<void>}
 */
async function trackFastRequests(userId) {
  if (!userId) return;
  
  try {
    const redis = await getRedisClient();
    if (!redis) return;
    
    const now = Date.now();
    const timesKey = ABUSE_KEYS.requestTimes(userId);
    
    // Obtener último request time
    const lastTime = await redis.get(timesKey);
    
    if (lastTime) {
      const interval = now - parseInt(lastTime);
      if (interval < ABUSE_THRESHOLDS.minRequestInterval) {
        await trackAbuse(userId, 'fast_requests', { interval });
      }
    }
    
    // Actualizar último tiempo
    await redis.set(timesKey, now.toString());
    await redis.expire(timesKey, 60); // 1 minuto TTL
  } catch (error) {
    console.error('❌ Error en trackFastRequests:', error.message);
  }
}

/**
 * Limpia registro de abuso (para admin)
 * @param {string} userId - ID del usuario
 * @returns {Promise<void>}
 */
async function clearAbuseRecord(userId) {
  if (!userId) return;
  
  try {
    const redis = await getRedisClient();
    if (!redis) return;
    
    const keys = [
      ABUSE_KEYS.rateLimitEvents(userId),
      `${ABUSE_KEYS.rateLimitEvents(userId)}:count`,
      ABUSE_KEYS.block(userId),
      ABUSE_KEYS.suspicious(userId),
      ABUSE_KEYS.requestTimes(userId),
      ABUSE_KEYS.payloadSizes(userId),
    ];
    
    await redis.del(...keys);
    console.log(`🧹 Registro de abuso limpiado para: ${userId}`);
  } catch (error) {
    console.error('❌ Error en clearAbuseRecord:', error.message);
  }
}

/**
 * Middleware Express para verificar bloqueo antes de procesar request
 * @returns {Function} Middleware Express
 */
function abuseDetectionMiddleware() {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id || req.user?.userId;
      
      if (!userId) {
        // Para usuarios anónimos, usar IP
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';
        const { blocked } = await isBlocked(`ip:${ip}`);
        if (blocked) {
          return res.status(403).json({
            error: 'temporarily_blocked',
            message: 'Demasiadas requests sospechosas. Intente más tarde.',
          });
        }
        return next();
      }
      
      // Trackear request rápido
      await trackFastRequests(userId);
      
      // Verificar bloqueo
      const { blocked, blockUntil } = await isBlocked(userId);
      
      if (blocked) {
        const retryAfter = Math.ceil((blockUntil.getTime() - Date.now()) / 1000);
        return res.status(403).json({
          error: 'temporarily_blocked',
          message: 'Cuenta temporalmente bloqueada por actividad sospechosa',
          retry_after: retryAfter,
        });
      }
      
      next();
    } catch (error) {
      console.error('❌ Error en abuseDetectionMiddleware:', error.message);
      // Fail open
      next();
    }
  };
}

module.exports = {
  trackAbuse,
  isBlocked,
  getAbuseReport,
  trackLargePayload,
  trackFastRequests,
  clearAbuseRecord,
  abuseDetectionMiddleware,
  ABUSE_THRESHOLDS,
};
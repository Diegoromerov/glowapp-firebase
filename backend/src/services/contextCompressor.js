/**
 * backend/src/services/contextCompressor.js
 * Servicio de compresión de historial de conversación para AURA
 * Comprime historial >20 mensajes manteniendo últimos 15 + resumen
 * Cache en Redis con TTL 1 hora
 */

const { breakers } = require('./circuitBreakerService');
const { pool } = require('../config/db');

/**
 * Cache en memoria para resúmenes (fallback si Redis no disponible)
 */
const memoryCache = new Map();
const CACHE_TTL = 3600000; // 1 hora en ms

/**
 * Obtiene cliente Redis si está disponible
 * @returns {Object|null} Cliente Redis o null
 */
function getRedisClient() {
  try {
    // Intentar obtener del pool/config global
    if (global.redisClient) return global.redisClient;
    
    // Intentar crear cliente si hay URL
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      const Redis = require('redis');
      const client = Redis.createClient({ url: redisUrl });
      client.connect().catch(() => {});
      global.redisClient = client;
      return client;
    }
  } catch (error) {
    console.warn('⚠️ Redis no disponible para cache de contexto:', error.message);
  }
  return null;
}

/**
 * Genera resumen simple sin LLM (extrae keywords principales)
 * @param {Array} messages - Mensajes a resumir
 * @returns {string} Resumen simple
 */
function generateSimpleSummary(messages) {
  if (!messages || messages.length === 0) return 'Sin mensajes previos';
  
  // Extraer temas principales de mensajes de usuario
  const userMessages = messages.filter(m => m.role === 'user' || m.sender_id !== '0');
  const topics = new Set();
  
  const topicKeywords = {
    'cita': ['agendar', 'cita', 'reservar', 'horario', 'disponible'],
    'precio': ['precio', 'costo', 'cuánto', 'valor', 'tarifa'],
    'tratamiento': ['tratamiento', 'facial', 'láser', 'peeling', 'masaje'],
    'producto': ['producto', 'crema', 'sérum', 'comprar', 'recomendar'],
    'piel': ['piel', 'acné', 'seca', 'grasa', 'sensible', 'manchas'],
    'cabello': ['cabello', 'pelo', 'corte', 'tinte', 'keratina'],
    'uñas': ['uñas', 'manicura', 'gel', 'semipermanente'],
    'ubicación': ['dónde', 'ubicación', 'dirección', 'cerca', 'Bogotá'],
  };
  
  for (const msg of userMessages) {
    const text = (msg.content || msg.message || '').toLowerCase();
    for (const [topic, keywords] of Object.entries(topicKeywords)) {
      if (keywords.some(kw => text.includes(kw))) {
        topics.add(topic);
      }
    }
  }
  
  const topicList = Array.from(topics).slice(0, 5);
  return `[Resumen: ${messages.length} mensajes previos. Temas: ${topicList.join(', ') || 'general'}]`;
}

/**
 * Genera resumen con LLM (DeepSeek/Gemini)
 * @param {Array} messages - Mensajes a resumir
 * @returns {Promise<string>} Resumen generado
 */
async function generateSummaryWithLLM(messages) {
  if (!messages || messages.length === 0) return 'Sin mensajes previos';
  
  // Preparar texto para el LLM
  const text = messages
    .map(m => `${m.role === 'user' || m.sender_id !== '0' ? 'Usuario' : 'Aura'}: ${m.content || m.message || ''}`)
    .join('\n')
    .slice(0, 3000);
  
  // Usar circuit breaker DeepSeek
  if (breakers?.deepseek) {
    try {
      return await breakers.deepseek.execute(
        async () => {
          const axios = require('axios');
          const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
          const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/chat/completions';
          const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
          
          const prompt = `Resume brevemente esta conversación en 1-2 frases en español, enfocándote en los temas principales y necesidades del usuario:

${text}

Formato: "El usuario consultó sobre [temas]. [Necesidad principal o acción pendiente]."`;

          const response = await axios.post(
            DEEPSEEK_BASE_URL,
            {
              model: DEEPSEEK_MODEL,
              messages: [{ role: 'user', content: prompt }],
              temperature: 0.3,
              max_tokens: 150,
            },
            {
              headers: {
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                'Content-Type': 'application/json',
              },
              timeout: 10000,
            }
          );
          
          return response.data?.choices?.[0]?.message?.content || generateSimpleSummary(messages);
        },
        () => generateSimpleSummary(messages)
      );
    } catch (error) {
      console.warn('⚠️ LLM summary falló, usando simple:', error.message);
    }
  }
  
  // Fallback a Gemini si disponible
  if (breakers?.gemini) {
    try {
      return await breakers.gemini.execute(
        async () => {
          // Similar a DeepSeek pero con Gemini
          return generateSimpleSummary(messages);
        },
        () => generateSimpleSummary(messages)
      );
    } catch (error) {
      console.warn('⚠️ Gemini summary falló:', error.message);
    }
  }
  
  return generateSimpleSummary(messages);
}

/**
 * Obtiene resumen cacheado
 * @param {string} userId - ID del usuario
 * @returns {Promise<string|null>} Resumen cacheado o null
 */
async function getCachedSummary(userId) {
  // Primero intentar Redis
  const redis = getRedisClient();
  if (redis) {
    try {
      const cached = await redis.get(`context_summary:${userId}`);
      if (cached) return cached;
    } catch (error) {
      console.warn('⚠️ Error leyendo Redis:', error.message);
    }
  }
  
  // Fallback a memoria
  const memCache = memoryCache.get(userId);
  if (memCache && Date.now() - memCache.timestamp < CACHE_TTL) {
    return memCache.summary;
  }
  
  return null;
}

/**
 * Guarda resumen en cache
 * @param {string} userId - ID del usuario
 * @param {string} summary - Resumen a guardar
 * @returns {Promise<void>}
 */
async function setCachedSummary(userId, summary) {
  // Guardar en Redis
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.setEx(`context_summary:${userId}`, 3600, summary);
    } catch (error) {
      console.warn('⚠️ Error guardando en Redis:', error.message);
    }
  }
  
  // Guardar en memoria
  memoryCache.set(userId, { summary, timestamp: Date.now() });
  
  // Limpiar cache viejo (max 1000 entries)
  if (memoryCache.size > 1000) {
    const firstKey = memoryCache.keys().next().value;
    memoryCache.delete(firstKey);
  }
}

/**
 * Comprime historial de conversación
 * @param {Array} messages - Array de mensajes (formato DeepSeek/Gemini)
 * @param {string} userId - ID del usuario
 * @returns {Promise<Array>} Mensajes comprimidos (máx 16: 1 summary + 15 recientes)
 */
async function compressHistory(messages, userId) {
  if (!messages || !Array.isArray(messages) || messages.length <= 20) {
    return messages || [];
  }
  
  try {
    // Separar: mensajes antiguos (para resumir) + últimos 15
    const recentMessages = messages.slice(-15);
    const olderMessages = messages.slice(0, -15);
    
    // Verificar cache
    let summary = await getCachedSummary(userId);
    
    if (!summary) {
      // Generar resumen (LLM si disponible, sino simple)
      summary = await generateSummaryWithLLM(olderMessages);
      
      // Cachear
      await setCachedSummary(userId, summary);
    }
    
    // Retornar: resumen + últimos 15 mensajes
    const summaryMessage = {
      role: 'system',
      content: `${summary} (${olderMessages.length} mensajes anteriores comprimidos)`
    };
    
    return [summaryMessage, ...recentMessages];
    
  } catch (error) {
    console.error('❌ Error comprimiendo historial:', error.message);
    // Fallback: retornar últimos 20 sin comprimir
    return messages.slice(-20);
  }
}

/**
 * Limpia cache de un usuario específico
 * @param {string} userId - ID del usuario
 * @returns {Promise<void>}
 */
async function clearUserCache(userId) {
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.del(`context_summary:${userId}`);
    } catch (error) {
      console.warn('⚠️ Error limpiando Redis:', error.message);
    }
  }
  memoryCache.delete(userId);
}

/**
 * Obtiene stats del cache
 * @returns {Object} Stats
 */
function getCacheStats() {
  return {
    memorySize: memoryCache.size,
    keys: Array.from(memoryCache.keys()).slice(0, 20),
  };
}

module.exports = {
  compressHistory,
  generateSimpleSummary,
  generateSummaryWithLLM,
  getCachedSummary,
  setCachedSummary,
  clearUserCache,
  getCacheStats,
};
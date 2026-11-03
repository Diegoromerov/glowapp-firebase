/**
 * backend/src/config/serviceHealth.js
 * Verificación de salud de servicios externos para GlowApp
 * No crashea si falta una key: loggea warning y continúa
 */

const { pool } = require('./db');

/**
 * Verifica salud de todos los servicios
 * @returns {Object} Estado de cada servicio
 */
async function checkServiceHealth() {
  const results = {
    deepseek: { available: false, reason: 'MISSING_API_KEY' },
    gemini: { available: false, reason: 'MISSING_API_KEY' },
    nvidia: { available: false, reason: 'MISSING_API_KEY' },
    database: { available: false, reason: 'MISSING_URL' },
    redis: { available: false, reason: 'MISSING_URL' },
  };
  
  // DEEPSEEK
  if (process.env.DEEPSEEK_API_KEY) {
    results.deepseek = { available: true, reason: 'OK' };
  } else {
    console.warn('⚠️ DEEPSEEK_API_KEY no configurada - DeepSeek no disponible');
  }
  
  // GEMINI
  if (process.env.GEMINI_API_KEY) {
    results.gemini = { available: true, reason: 'OK' };
  } else {
    console.warn('⚠️ GEMINI_API_KEY no configurada - Gemini fallback no disponible');
  }
  
  // NVIDIA
  if (process.env.NVIDIA_API_KEY) {
    results.nvidia = { available: true, reason: 'OK' };
  } else {
    console.warn('⚠️ NVIDIA_API_KEY no configurada - Embeddings no disponibles');
  }
  
  // DATABASE
  if (process.env.DATABASE_URL) {
    try {
      // Test de conexión rápida
      await pool.query('SELECT 1');
      results.database = { available: true, reason: 'OK' };
    } catch (error) {
      results.database = { available: false, reason: `CONNECTION_FAILED: ${error.message}` };
      console.error('❌ Error conectando a PostgreSQL:', error.message);
    }
  } else {
    console.warn('⚠️ DATABASE_URL no configurada - Base de datos no disponible');
  }
  
  // REDIS
  if (process.env.REDIS_URL) {
    try {
      const Redis = require('redis');
      const client = Redis.createClient({ url: process.env.REDIS_URL });
      await client.connect();
      await client.ping();
      await client.quit();
      results.redis = { available: true, reason: 'OK' };
    } catch (error) {
      results.redis = { available: false, reason: `CONNECTION_FAILED: ${error.message}` };
      console.warn('⚠️ Redis no disponible:', error.message);
    }
  } else {
    console.warn('⚠️ REDIS_URL no configurada - Cache no disponible (usando memoria)');
  }
  
  return results;
}

/**
 * Verifica si un servicio específico está disponible
 * @param {string} serviceName - Nombre del servicio
 * @returns {Promise<boolean>} true si disponible
 */
async function isServiceAvailable(serviceName) {
  const health = await checkServiceHealth();
  return health[serviceName]?.available === true;
}

/**
 * Loggea estado de todos los servicios al inicio
 * @returns {Promise<void>}
 */
async function logServiceStatus() {
  console.log('\n=== ESTADO DE SERVICIOS ===');
  
  const health = await checkServiceHealth();
  
  for (const [service, status] of Object.entries(health)) {
    const icon = status.available ? '✅' : '❌';
    console.log(`  ${icon} ${service.toUpperCase()}: ${status.reason}`);
  }
  
  const availableCount = Object.values(health).filter(s => s.available).length;
  const totalCount = Object.keys(health).length;
  
  console.log(`\n  Servicios disponibles: ${availableCount}/${totalCount}`);
  
  if (availableCount < totalCount) {
    console.warn('  ⚠️  Algunos servicios no disponibles - funcionalidad limitada');
  }
  
  console.log('============================\n');
  
  return health;
}

/**
 * Verificación rápida solo de API keys (sin conexión)
 * @returns {Object} Estado de API keys
 */
function checkApiKeysOnly() {
  return {
    deepseek: !!process.env.DEEPSEEK_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
    nvidia: !!process.env.NVIDIA_API_KEY,
    database: !!process.env.DATABASE_URL,
    redis: !!process.env.REDIS_URL,
  };
}

module.exports = {
  checkServiceHealth,
  isServiceAvailable,
  logServiceStatus,
  checkApiKeysOnly,
};
// backend/src/config/redis.js
const redis = require('redis');
require('dotenv').config();

const env = process.env.NODE_ENV || 'development';
const rawUrl = process.env.REDIS_URL;
const host = process.env.REDIS_HOST;
const port = process.env.REDIS_PORT || 6379;

let redisUrl = null;

if (rawUrl && rawUrl.trim() !== '' && rawUrl !== 'redis://:') {
  redisUrl = rawUrl.trim();
} else if (host && host.trim() !== '') {
  redisUrl = `redis://${host.trim()}:${port}`;
} else if (env === 'development') {
  // En desarrollo local sin Docker Compose, intentar localhost:6379 únicamente
  redisUrl = `redis://localhost:${port}`;
}

let redisClient = null;

if (!redisUrl) {
  console.log('ℹ️  [REDIS STATUS] DISABLED / NOT_CONFIGURED — Operando en modo degradado nativo (BD/Memoria).');
  
  const createDummyMulti = () => {
    const dummyMulti = {
      zRemRangeByScore: () => dummyMulti,
      zCard: () => dummyMulti,
      zAdd: () => dummyMulti,
      expire: () => dummyMulti,
      exec: async () => [0, 0, 1, 1],
    };
    return dummyMulti;
  };

  // Objeto inactivo para prevenir crashes por accesos directos sin comprobación null
  redisClient = {
    isOpen: false,
    isReady: false,
    on: () => {},
    connect: async () => {},
    disconnect: async () => {},
    quit: async () => {},
    get: async () => null,
    set: async () => null,
    setEx: async () => null,
    del: async () => null,
    exists: async () => 0,
    expire: async () => 0,
    lPush: async () => 0,
    rPush: async () => 0,
    rpush: async () => 0,
    zRange: async () => [],
    zRemRangeByScore: async () => 0,
    zCard: async () => 0,
    zAdd: async () => 0,
    multi: () => createDummyMulti(),
  };
} else {
  try {
    redisClient = redis.createClient({
      url: redisUrl,
      socket: {
        reconnectStrategy: (retries) => {
          // Detener reintentos continuos tras 3 intentos para no inundar logs
          if (retries >= 3) {
            return new Error('Max reconnect retries reached');
          }
          return Math.min(retries * 500, 2000);
        }
      }
    });

    let loggedError = false;

    redisClient.on('error', (err) => {
      if (!loggedError) {
        loggedError = true;
        console.error(`🚨 [REDIS STATUS] DEGRADED / CONNECTION_FAILED (${redisUrl}): ${err.message}`);
      }
    });

    redisClient.on('connect', () => {
      loggedError = false;
      console.log(`✅ [REDIS STATUS] ENABLED / CONNECTED (${redisUrl})`);
    });

    (async () => {
      try {
        await redisClient.connect();
      } catch (_) {
        // La falla de conexión inicial la gestiona el listener de 'error'
      }
    })();
  } catch (initErr) {
    console.warn(`⚠️  [REDIS STATUS] INITIALIZATION_FAILED (${redisUrl}): ${initErr.message}`);
  }
}

module.exports = redisClient;

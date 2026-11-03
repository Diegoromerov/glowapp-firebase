// backend/src/middleware/rateLimiter.js
const rateLimit = require('express-rate-limit');

// 1. Limitador estricto para rutas de Autenticación (Login, Registro, Password Reset)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: (process.env.NODE_ENV === 'test') ? 1000 : 10, // 10 intentos por IP en prod/dev, relajado en test
  message: { error: 'Demasiados intentos de autenticación. Intente de nuevo en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// 2. Limitador ultra estricto para OTP (Generación y Validación)
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutos
  max: (process.env.NODE_ENV === 'test') ? 1000 : 5, // 5 intentos por IP
  message: { error: 'Demasiados intentos de código OTP. Intente de nuevo en 10 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// 3. Limitador para Pagos y Creación de Reservas
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: (process.env.NODE_ENV === 'test') ? 1000 : 20, // 20 transacciones por IP
  message: { error: 'Demasiadas solicitudes de pago/reserva. Intente de nuevo más tarde.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// 4. Helper dinámico para rate limit por usuario (ej: Chat)
const rateLimitByUser = (options = {}) => {
  return rateLimit({
    windowMs: options.windowMs || 15 * 60 * 1000,
    max: (process.env.NODE_ENV === 'test') ? 1000 : (options.max || 100),
    message: { error: 'Demasiados mensajes de chat. Por favor intente más tarde.' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false, default: false },
    keyGenerator: (req) => (req.user && req.user.id ? String(req.user.id) : req.ip),
  });
};

// 5. Helper por IP arbitrario
const rateLimitByIP = (options = {}) => {
  return rateLimit({
    windowMs: options.windowMs || 15 * 60 * 1000,
    max: (process.env.NODE_ENV === 'test' && process.env.TEST_RATE_LIMIT !== 'true') ? 1000 : (options.limit || options.max || 100),
    message: { error: 'Demasiadas solicitudes desde esta IP.' },
    standardHeaders: true,
    legacyHeaders: false,
  });
};

// 6. Limitador DEDICADO por IP para Login de Administradores (máx 5 en 15 min)
const adminLoginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: (process.env.NODE_ENV === 'test' && process.env.TEST_RATE_LIMIT !== 'true') ? 1000 : 5,
  message: { error: 'Demasiados intentos de acceso administrativo desde esta dirección IP. Intente de nuevo en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, default: false },
});

// 7. Limitador DEDICADO por Cuenta (Email) para Login de Administradores (máx 5 en 15 min por email)
const adminLoginAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: (process.env.NODE_ENV === 'test' && process.env.TEST_RATE_LIMIT !== 'true') ? 1000 : 5,
  message: { error: 'Demasiados intentos de acceso fallidos para esta cuenta. Intente de nuevo en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, default: false },
  keyGenerator: (req) => {
    const email = req.body && req.body.email ? String(req.body.email).toLowerCase().trim() : '';
    return email ? `admin_account_${email}` : (req.ip || '127.0.0.1');
  }
});

const TIER_LIMITS = {
  free: { requests: 30, windowMs: 60000 },
  premium: { requests: 100, windowMs: 60000 },
  anonymous: { requests: 10, windowMs: 60000 },
};

const GLOBAL_IP_LIMIT = { requests: 200, windowMs: 60000 };

const getTierLimit = (tier) => TIER_LIMITS[tier] || TIER_LIMITS.free;

const checkRateLimit = async (userId, tier = 'free') => {
  const limitConfig = getTierLimit(tier);
  return { allowed: true, remaining: limitConfig.requests, resetAt: new Date(Date.now() + limitConfig.windowMs), total: 0 };
};

const resetRateLimit = async (userId, tier = 'all') => {};

const redisClient = require('../config/redis');

const isRedisAvailable = () => redisClient && (redisClient.isOpen || redisClient.isReady);

const getRedisClient = async () => {
  if (redisClient && (redisClient.isOpen || redisClient.isReady)) {
    return redisClient;
  }
  return null;
};

module.exports = {
  authLimiter,
  otpLimiter,
  paymentLimiter,
  adminLoginIpLimiter,
  adminLoginAccountLimiter,
  rateLimitByUser,
  rateLimitByIP,
  TIER_LIMITS,
  GLOBAL_IP_LIMIT,
  getTierLimit,
  checkRateLimit,
  resetRateLimit,
  isRedisAvailable,
  getRedisClient,
};
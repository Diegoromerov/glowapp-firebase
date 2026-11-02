// backend/src/middleware/idempotency.js
/**
 * Idempotency Middleware para Endpoints Biométricos
 * Cumplimiento ADR-001 (Checklist Item 5): Header Idempotency-Key obligatorio en POST mutantes.
 */

// Memory Cache / Redis Fallback simple en memoria para llaves de idempotencia (expira a las 24 horas)
const idempotencyCache = new Map();

// Limpieza periódica de llaves expiras (cada hora)
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of idempotencyCache.entries()) {
    if (value.expiresAt < now) {
      idempotencyCache.delete(key);
    }
  }
}, 3600 * 1000);

const idempotencyMiddleware = (req, res, next) => {
  // Solo aplicar a métodos mutantes
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) {
    return next();
  }

  const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];

  if (!idempotencyKey) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'El encabezado Idempotency-Key es obligatorio para peticiones mutantes biométricas.',
      code: 'MISSING_IDEMPOTENCY_KEY',
    });
  }

  const cachedResponse = idempotencyCache.get(idempotencyKey);
  if (cachedResponse) {
    console.log(`⚡ [IDEMPOTENCY] Petición duplicada interceptada. Key: ${idempotencyKey}`);
    return res.status(cachedResponse.status).json(cachedResponse.body);
  }

  // Interceptar la respuesta para cachearla antes de enviar
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    // Cachear únicamente si el resultado es exitoso (2xx)
    if (res.statusCode >= 200 && res.statusCode < 300) {
      idempotencyCache.set(idempotencyKey, {
        status: res.statusCode,
        body,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 horas
      });
    }
    return originalJson(body);
  };

  next();
};

module.exports = idempotencyMiddleware;

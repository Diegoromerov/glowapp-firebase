// backend/src/middleware/traceId.js
const { v4: uuidv4 } = require('uuid');

/**
 * Middleware para generar o validar traceId consistente en todas las requests
 * Garantiza que cada request tenga un traceId único para trazabilidad
 */
const traceIdMiddleware = (req, res, next) => {
  // Extraer traceId del header si existe, o generar uno nuevo
  const traceId = req.headers['x-trace-id'] || req.headers['traceid'] || uuidv4();
  
  // Adjuntar traceId al request para que esté disponible en todos los servicios
  req.traceId = traceId;
  
  // También agregarlo al response header para que el cliente lo tenga
  res.setHeader('X-Trace-Id', traceId);
  
  // Añadir a locals para que esté disponible en templates si se usan
  res.locals.traceId = traceId;
  
  next();
};

module.exports = traceIdMiddleware;

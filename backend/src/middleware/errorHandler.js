// backend/src/middleware/errorHandler.js
//
// Sin este middleware, cualquier `next(err)` —incluidos los que producen los
// wrappers `ah()` / `wrapRouterAsync` de src/utils/expressAsync.js— cae en el
// handler por defecto de Express: una página HTML de 500, sin `request_id` y
// sin log estructurado. La app Flutter y el panel esperan JSON.
//
// Debe registrarse DESPUÉS de todas las rutas (incluido el catch-all 404 de
// /api/*) y ANTES de module.exports: Express identifica el middleware de error
// por su aridad de 4 argumentos.

module.exports = function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const status =
    Number(err && err.statusCode) || Number(err && err.status) || 500;

  const requestId =
    (req && req.id) ||
    (req && req.headers && (req.headers['x-request-id'] || req.headers['x-correlation-id'])) ||
    null;

  console.error(
    `❌ [${requestId || '-'}] ${(req && req.method) || '-'} ${(req && req.originalUrl) || '-'}:`,
    err && err.message
  );

  // 5xx: nunca se filtra el mensaje interno (puede contener SQL o rutas).
  const mensaje =
    status >= 500 ? 'Error interno del servidor' : (err && err.message) || 'Error';

  res.status(status).json({
    success: false,
    error: mensaje,
    request_id: requestId,
  });
};

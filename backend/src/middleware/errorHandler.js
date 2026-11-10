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
    (err && err.message) || String(err),
    err && err.constructor ? `(tipo: ${err.constructor.name})` : `(tipo: ${typeof err})`
  );

  // Ítem 70: un 5xx que solo vive en el log de la consola no se puede contar.
  // Se guarda como evento para que `/api/analytics/summary` lo agrupe por tipo y
  // la ruta quede en metadata. Es best-effort: si la base tampoco responde, el
  // error original no debe convertirse en una excepción del handler de errores.
  if (status >= 500) {
    try {
      const { pool } = require('../config/db');
      pool
        .query(
          `INSERT INTO analytics_events (user_id, event_type, metadata, occurred_at)
           VALUES (NULL, 'API_5XX', $1, NOW())`,
          [
            JSON.stringify({
              ruta: (req && req.originalUrl) || null,
              metodo: (req && req.method) || null,
              status,
              request_id: requestId,
              tipo: (err && err.constructor && err.constructor.name) || null,
            }),
          ],
        )
        .catch(() => {});
    } catch (_) {
      // Nunca romper la respuesta por el registro.
    }
  }

  // 5xx: nunca se filtra el mensaje interno (puede contener SQL o rutas).
  const mensaje =
    status >= 500 ? 'Error interno del servidor' : (err && err.message) || 'Error';

  res.status(status).json({
    success: false,
    error: mensaje,
    request_id: requestId,
  });
};

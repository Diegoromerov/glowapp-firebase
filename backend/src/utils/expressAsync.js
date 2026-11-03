// backend/src/utils/expressAsync.js
// Express 4 no propaga los rechazos de handlers `async` a `next(err)`: una promesa
// rechazada se convierte en `unhandledRejection` y, en Node >= 15, TERMINA EL PROCESO.
// En lugar de un 500 la API se caía (auditoría 2026-09-22, hallazgo T4 #3 / H-11).

/** Marca los handlers ya envueltos para que envolver sea idempotente. */
const WRAPPED = Symbol.for('glow.expressAsync.wrapped');

/** Envuelve un handler para que cualquier throw/reject llegue a next(err). */
const ah = (handler) => {
  const wrapped = (req, res, next) => {
    try {
      return Promise.resolve(handler(req, res, next)).catch(next);
    } catch (err) {
      return next(err);
    }
  };
  Object.defineProperty(wrapped, WRAPPED, { value: true });
  return wrapped;
};

/**
 * Envuelve un handler preservando su aridad real. Express identifica el
 * middleware de error por su aridad (`(err, req, res, next)` === 4); si al
 * envolverlo lo dejáramos en 3, Express lo trataría como middleware normal y
 * dejaría de manejar errores.
 */
const wrapHandler = (handler) => {
  if (typeof handler !== 'function') return handler;
  if (handler[WRAPPED]) return handler; // ya envuelto — no re-envolver
  if (handler.length === 4) {
    const wrapped = (err, req, res, next) => {
      try {
        return Promise.resolve(handler(err, req, res, next)).catch(next);
      } catch (e) {
        return next(e);
      }
    };
    Object.defineProperty(wrapped, WRAPPED, { value: true });
    return wrapped;
  }
  return ah(handler);
};

/**
 * Recorre TODAS las capas de un stack Express, en profundidad (universal):
 *   - handlers de ruta              → `layer.route.stack[].handle`
 *   - middleware y error middleware → `layer.handle`
 *   - routers anidados montados con `router.use(subRouter)` → `layer.handle.stack`
 * Es idempotente: re-envolver no vuelve a envolver lo ya envuelto.
 */
const wrapStackAsync = (stack) => {
  if (!Array.isArray(stack)) return;
  for (const layer of stack) {
    if (layer.route && Array.isArray(layer.route.stack)) {
      for (const handlerLayer of layer.route.stack) {
        handlerLayer.handle = wrapHandler(handlerLayer.handle);
      }
      continue; // la capa de ruta ya cubre su dispatch; no tocar `layer.handle`
    }
    if (typeof layer.handle !== 'function') continue;
    // Un router montado es una función con su propio `.stack` (express.Router()).
    // Se desciende en él; NO se envuelve la función del router (perdería `.stack`
    // y rompería la recursión/el montaje).
    if (Array.isArray(layer.handle.stack)) {
      wrapStackAsync(layer.handle.stack);
    } else {
      layer.handle = wrapHandler(layer.handle);
    }
  }
};

/**
 * Envuelve TODAS las capas de un router (o app) ya declarado —incluidos los
 * routers anidados— sin tocar cada handler. Universal: una sola llamada en la
 * raíz cubre el árbol completo, de modo que un router olvidado en cualquier
 * profundidad no puede tumbar el proceso.
 */
const wrapRouterAsync = (router) => {
  if (!router || !Array.isArray(router.stack)) return router;
  wrapStackAsync(router.stack);
  return router;
};

module.exports = { ah, wrapRouterAsync };

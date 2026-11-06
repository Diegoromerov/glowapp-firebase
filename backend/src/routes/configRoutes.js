// backend/src/routes/configRoutes.js
//
// Ítem 80 — feature flags. Permite apagar una función sin publicar versión nueva:
// el servidor manda el estado y la app deja de mostrar lo que esté apagado.
//
// Fuente: variable de entorno FEATURE_FLAGS con JSON, por ejemplo
//   FEATURE_FLAGS={"propinas":false,"glowstore":true}
// Sin variable, todo queda encendido (fail-open: nunca se apaga nada por un
// JSON mal escrito, que dejaría a los usuarios sin funciones sin motivo).
//
// Caché de 60 s: cambiar la variable en Railway se refleja en un minuto y no se
// consulta el entorno en cada petición.

const express = require('express');
const router = express.Router();

const TTL_MS = 60 * 1000;

let cache = null;
let cacheHasta = 0;

function leerFlags() {
  const ahora = Date.now();
  if (cache && ahora < cacheHasta) return cache;

  let flags = {};
  const crudo = process.env.FEATURE_FLAGS;
  if (crudo && crudo.trim()) {
    try {
      const parseado = JSON.parse(crudo);
      if (parseado && typeof parseado === 'object' && !Array.isArray(parseado)) {
        flags = Object.fromEntries(
          Object.entries(parseado)
            .filter(([, v]) => typeof v === 'boolean')
            .map(([k, v]) => [String(k), v])
        );
      } else {
        console.warn('[FLAGS] FEATURE_FLAGS no es un objeto JSON; se ignoran');
      }
    } catch (error) {
      console.warn(`[FLAGS] FEATURE_FLAGS no es JSON válido (${error.message}); se ignoran`);
    }
  }

  cache = flags;
  cacheHasta = ahora + TTL_MS;
  return flags;
}

/// Middleware: corta una familia de endpoints cuando su bandera está apagada.
/// Va ANTES de authMiddleware a propósito: si la función está apagada no hay
/// nada que autenticar, y así el rechazo es 409 y no un engañoso 401.
function requireFlag(nombre) {
  return function (req, res, next) {
    if (leerFlags()[nombre] === false) {
      return res.status(409).json({
        error: `La función '${nombre}' está desactivada por ahora`,
        flag: nombre,
      });
    }
    return next();
  };
}
/// GET /api/config/flags — sin autenticación: no revela datos de nadie.
router.get('/config/flags', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({ success: true, flags: leerFlags(), actualizado: new Date().toISOString() });
});

module.exports = router;
module.exports.leerFlags = leerFlags;
module.exports.requireFlag = requireFlag;

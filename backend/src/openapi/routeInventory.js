'use strict';

/**
 * backend/src/openapi/routeInventory.js
 *
 * Inventario del contrato HTTP que el backend REALMENTE monta.
 *
 * Fuente de verdad = el stack de Express en tiempo de ejecución, no la
 * documentación escrita a mano. Cualquier ruta montada que no esté en el
 * contrato OpenAPI es deriva de API, y esta es la herramienta que la mide.
 *
 * Se usa desde:
 *   - scripts/generateOpenApiSpec.js  (generador del artefacto)
 *   - src/openapi/verifySpecAgainstApp.js (compuerta de deriva)
 */

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

/**
 * Normaliza el `regexp.source` de un layer de Express a un prefijo legible.
 * Mismo algoritmo que src/tests/routing.contract.test.js (ORDEN A-03) para que
 * ambos tests hablen del mismo conjunto de rutas.
 */
function cleanRegexpSource(source) {
  if (!source || source === '^\\/' || source === '^\\/\\/?') return '';
  let cleaned = source
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)/g, '')
    .replace(/\$\/?$/, '')
    .replace(/\\\//g, '/')
    .replace(/\?\(\?=\/\|\$\)/g, '')
    .replace(/\?$/, '');
  if (!cleaned.startsWith('/')) {
    cleaned = '/' + cleaned;
  }
  return cleaned;
}

/**
 * Convierte la ruta de Express en la clave de `paths` de OpenAPI.
 *   /api/providers/:id  ->  /api/providers/{id}
 */
function toOpenApiPath(expressPath) {
  return String(expressPath).replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/**
 * Recorre el stack de Express y devuelve todas las operaciones montadas.
 * @returns {Array<{method: string, path: string}>} ordenado y sin duplicados
 *          de forma exacta (los duplicados se reportan aparte con duplicateOperations).
 */
function extractRoutes(app) {
  const collected = [];

  const walk = (stack, prefix) => {
    if (!stack) return;
    stack.forEach((layer) => {
      if (layer.route) {
        const routePath = layer.route.path === '/' ? '' : layer.route.path;
        const full = ((prefix || '') + routePath).replace(/\/+/g, '/') || '/';
        HTTP_METHODS.forEach((verb) => {
          if (layer.route.methods && layer.route.methods[verb]) {
            collected.push({ method: verb.toUpperCase(), path: full });
          }
        });
      } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
        walk(
          layer.handle.stack,
          (prefix || '') + cleanRegexpSource(layer.regexp ? layer.regexp.source : '')
        );
      }
    });
  };

  walk(app && app._router ? app._router.stack : [], '');

  return collected
    .map((r) => ({ method: r.method, path: r.path.replace(/\/$/, '') || '/' }))
    .sort((a, b) => (a.path + ' ' + a.method).localeCompare(b.path + ' ' + b.method));
}

/**
 * Subconjunto bajo /api (el contrato público de la API).
 * Excluye el fallback del SPA y el `app.get('*')` del socket.
 */
function extractApiRoutes(app) {
  return extractRoutes(app).filter((r) => r.path === '/api' || r.path.startsWith('/api/'));
}

/**
 * Operaciones montadas más de una vez (mismo método y misma ruta).
 * Es un defecto de enrutamiento pre-existente (ver routing.contract.test.js):
 * aquí se controla que la lista no crezca.
 */
function duplicateOperations(routes) {
  const seen = new Set();
  const duplicates = [];
  routes.forEach((r) => {
    const key = `${r.method} ${r.path}`;
    if (seen.has(key)) {
      duplicates.push(key);
    } else {
      seen.add(key);
    }
  });
  return duplicates;
}

module.exports = {
  HTTP_METHODS,
  cleanRegexpSource,
  toOpenApiPath,
  extractRoutes,
  extractApiRoutes,
  duplicateOperations,
};

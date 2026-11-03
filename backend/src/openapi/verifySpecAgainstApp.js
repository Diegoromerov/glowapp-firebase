'use strict';

/**
 * backend/src/openapi/verifySpecAgainstApp.js
 *
 * Compuerta de contrato: compara el documento OpenAPI con las rutas que el
 * backend monta de verdad. Devuelve un informe de deriva en vez de lanzar, para
 * que lo usen tanto el test (jest) como el script de CI (exit code).
 *
 * Deriva detectada:
 *   - missing  : ruta montada y NO declarada en el contrato  (endpoint sin documentar)
 *   - orphan   : ruta declarada y NO montada                 (contrato obsoleto)
 *   - undocumentedCritical : operación crítica sin contrato explícito
 *   - duplicates          : mismo método+ruta montado dos veces
 */

const { HTTP_METHODS, toOpenApiPath, extractApiRoutes, duplicateOperations } = require('./routeInventory');

function specOperations(spec) {
  const ops = [];
  const paths = (spec && spec.paths) || {};
  Object.keys(paths).forEach((p) => {
    HTTP_METHODS.forEach((verb) => {
      if (paths[p] && paths[p][verb]) {
        ops.push({ method: verb.toUpperCase(), path: p, operation: paths[p][verb] });
      }
    });
  });
  return ops;
}

/**
 * @param {object} spec  documento OpenAPI (artefacto versionado)
 * @param {object} app   instancia real de Express
 * @param {object} [options]
 * @param {string[]} [options.criticalOperations] claves 'METHOD /ruta/{param}'
 * @param {string[]} [options.knownDuplicates]    defectos pre-existentes tolerados
 */
function compareSpecToApp(spec, app, options = {}) {
  const criticalOperations = options.criticalOperations || [];
  const knownDuplicates = options.knownDuplicates || [];

  const liveRoutes = extractApiRoutes(app);
  const liveKeys = new Set(liveRoutes.map((r) => `${r.method} ${toOpenApiPath(r.path)}`));

  const ops = specOperations(spec);
  const specKeys = new Set(ops.map((o) => `${o.method} ${o.path}`));
  const specKeyToOperation = new Map(ops.map((o) => [`${o.method} ${o.path}`, o.operation]));

  const missing = [...liveKeys].filter((k) => !specKeys.has(k)).sort();
  const orphan = [...specKeys].filter((k) => !liveKeys.has(k)).sort();

  const undocumentedCritical = criticalOperations
    .filter((k) => {
      const op = specKeyToOperation.get(k);
      return !op || op['x-glowapp-documented'] !== true;
    })
    .sort();

  const absentCritical = criticalOperations.filter((k) => !specKeys.has(k)).sort();

  const duplicates = duplicateOperations(liveRoutes);
  const newDuplicates = duplicates.filter((d) => !knownDuplicates.includes(d)).sort();

  const total = liveKeys.size;
  const covered = total - missing.length;

  return {
    total,
    covered,
    coveragePct: total === 0 ? 100 : Math.round((covered / total) * 10000) / 100,
    missing,
    orphan,
    undocumentedCritical,
    absentCritical,
    duplicates,
    newDuplicates,
    ok:
      missing.length === 0 &&
      orphan.length === 0 &&
      undocumentedCritical.length === 0 &&
      absentCritical.length === 0 &&
      newDuplicates.length === 0,
  };
}

module.exports = { compareSpecToApp, specOperations };

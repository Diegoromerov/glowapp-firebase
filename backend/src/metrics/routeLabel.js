'use strict';

/**
 * Normalización de la etiqueta `route` de las métricas HTTP.
 *
 * Hallazgo t_fix_infra_04 (P0 infra/observabilidad #4): sin métricas scrapeables
 * ningún recolector puede alertar. Pero al publicar métricas aparece un riesgo
 * nuevo: si la etiqueta de ruta se toma de la URL concreta, CADA id/token distinto
 * crea una serie temporal nueva y Prometheus se tumba por cardinalidad infinita.
 * Esta función pura concentra esa decisión para poder probarla sin red ni base.
 *
 * Reglas:
 *  1. Si Express resolvió una ruta, se usa su PATRÓN (`req.route.path`), nunca la
 *     URL concreta: `/api/providers/:id`, jamás `/api/providers/4711`.
 *  2. Si ninguna ruta coincidió (404/503 temprano), se devuelve `UNMATCHED`, jamás
 *     la URL cruda: la ruta desconocida no es una dimensión legítima.
 *  3. Nunca se incluye la query string ni el valor de ningún parámetro.
 *
 * @param {object} req petición de Express (o cualquier objeto con route/baseUrl)
 * @returns {string} etiqueta de cardinalidad acotada
 */

/** Etiqueta para peticiones que no casaron con ninguna ruta definida. */
const RUTA_DESCONOCIDA = 'UNMATCHED';

function normalizarRuta(req) {
  if (!req) return RUTA_DESCONOCIDA;

  const patron = req.route && typeof req.route.path === 'string' ? req.route.path : null;
  if (!patron) return RUTA_DESCONOCIDA;

  const base = typeof req.baseUrl === 'string' ? req.baseUrl : '';
  const completa = `${base}${patron}`;
  // Colapsa barras duplicadas de la unión base+patrón sin alterar el resto.
  return completa.replace(/\/{2,}/g, '/') || RUTA_DESCONOCIDA;
}

module.exports = { normalizarRuta, RUTA_DESCONOCIDA };

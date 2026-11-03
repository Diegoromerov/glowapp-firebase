'use strict';

/**
 * Observabilidad P0 (t_fix_infra_04 · FASE C · AUD-INFRA #4).
 *
 * Hallazgo: backend/index.js:98 montaba `express-status-monitor`, una página HTML
 * para un humano. No existía forma de que Prometheus hiciera scraping ni, por
 * tanto, de disparar alertas automáticas. `express-status-monitor` no expone
 * `/metrics`: sus datos viajan por socket.io.
 *
 * Este módulo añade el plano de observabilidad máquina-legible:
 *  - `GET /metrics` en formato de exposición Prometheus (sin autenticación: un
 *    scraper no puede hacer login).
 *  - `glowapp_up`: vitalidad del proceso (alerta de caída).
 *  - `glowapp_http_requests_total` / `glowapp_http_request_duration_seconds`:
 *    tasa de error y latencia, con la etiqueta `route` ACOTADA (ver routeLabel.js).
 *  - `glowapp_db_available` / `glowapp_db_degraded`: estado de la capa de datos
 *    tomado de getDbStatus(); permite alertar por degradación real sin mentir.
 *  - Métricas default de prom-client con prefijo `glowapp_` (CPU, memoria, event
 *    loop), que son la señal de runtime del proceso.
 *
 * La observabilidad nunca debe tumbar una petición: todo el registro de métricas
 * HTTP va envuelto para que un fallo ahí jamás propague al cliente.
 */
const client = require('prom-client');
const { getDbStatus } = require('../config/db');
const { normalizarRuta } = require('./routeLabel');

// Métricas por defecto del proceso (CPU, heap, event loop, handles...).
// Guardado a nivel de módulo: el módulo es singleton, se inicializa una sola vez.
let defaultMetricsIniciados = false;
if (!defaultMetricsIniciados) {
  client.collectDefaultMetrics({ prefix: 'glowapp_' });
  defaultMetricsIniciados = true;
}

/** Vitalidad: 1 mientras el proceso está vivo y sirviendo el scrapeo. */
const up = new client.Gauge({
  name: 'glowapp_up',
  help: '1 si el proceso está vivo y sirviendo peticiones.',
});
up.set(1);

/** Contador total de peticiones HTTP. Etiquetas de cardinalidad acotada. */
const httpRequestsTotal = new client.Counter({
  name: 'glowapp_http_requests_total',
  help: 'Total de peticiones HTTP procesadas por el backend.',
  labelNames: ['method', 'route', 'status_code'],
});

/** Histograma de duración de las peticiones HTTP (segundos). */
const httpRequestDuration = new client.Histogram({
  name: 'glowapp_http_request_duration_seconds',
  help: 'Duración de las peticiones HTTP en segundos.',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

/** 1 si la capa de datos (PostgreSQL) está disponible; 0 si no. */
const dbAvailable = new client.Gauge({
  name: 'glowapp_db_available',
  help: '1 si la capa de datos (PostgreSQL) está disponible; 0 si no.',
});

/** 1 si la capa de datos está degradada (memoria/fallback); 0 si no. */
const dbDegraded = new client.Gauge({
  name: 'glowapp_db_degraded',
  help: '1 si la capa de datos está degradada (memoria/fallback); 0 si no.',
});

/**
 * Middleware que mide cada petición. Se instala ANTES del candado de degradación
 * para que TODA respuesta (incluidos los 503 tempranos) quede contabilizada.
 */
function metricsMiddleware(req, res, next) {
  const inicio = process.hrtime.bigint();

  res.on('finish', () => {
    try {
      const labels = {
        method: (req.method || 'UNKNOWN').toUpperCase(),
        route: normalizarRuta(req),
        status_code: String(res.statusCode || 0),
      };
      httpRequestsTotal.inc(labels);
      const duracionSegundos = Number(process.hrtime.bigint() - inicio) / 1e9;
      httpRequestDuration.observe(labels, duracionSegundos);
    } catch (e) {
      // Nunca permitir que la observabilidad altere la respuesta al cliente.
    }
  });

  next();
}

/**
 * Refresca las métricas de la capa de datos desde la fuente de verdad
 * (getDbStatus). No se inventa disponibilidad: sin comprobación previa
 * (`pgAvailable === null`) se reporta 0 disponible, no 1.
 */
function actualizarMetricasDb() {
  let status = null;
  try {
    status = getDbStatus();
  } catch (e) {
    status = null;
  }

  const degradado = !!status && (status.servingFabricatedData === true || status.pgAvailable === false);
  const disponible = !!status && status.pgAvailable === true && status.servingFabricatedData !== true;

  dbAvailable.set(disponible ? 1 : 0);
  dbDegraded.set(degradado ? 1 : 0);
}

/**
 * Handler de `GET /metrics`. Sin autenticación: un recolector no puede autenticar.
 * Devuelve el formato de exposición de Prometheus (text/plain; version=0.0.4).
 */
async function metricsHandler(req, res) {
  actualizarMetricasDb();
  res.setHeader('Content-Type', client.register.contentType);
  res.status(200).end(await client.register.metrics());
}

module.exports = {
  metricsMiddleware,
  metricsHandler,
  actualizarMetricasDb,
  register: client.register,
};

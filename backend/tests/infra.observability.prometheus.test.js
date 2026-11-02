/**
 * P0 infra/observabilidad · t_fix_infra_04 — «Sin observabilidad P0 (Prometheus/alertas)»
 *
 * Hallazgo (FASE C · AUD-INFRA #4, revisión de infraestructura):
 *   backend/index.js:98 monta `express-status-monitor`, que es una página HTML de
 *   estado pensada para un humano. El proceso no publica métricas en formato de
 *   exposición Prometheus, así que NINGÚN recolector puede hacer scraping ni, por
 *   tanto, disparar alertas. `express-status-monitor` no expone /metrics; sus datos
 *   viajan por socket.io y no son consumibles por Prometheus/Alertmanager.
 *
 * Invariante probada (observabilidad P0 real = métricas scrapeables + alertas definidas):
 *   1. El proceso expone `GET /metrics` en el formato de exposición de Prometheus
 *      (text/plain; version=0.0.4), sin autenticación — un scraper no puede hacer login.
 *   2. `/metrics` publica contadores/Histogramas de peticiones HTTP con etiquetas de
 *      cardinalidad ACOTADA (nunca la URL cruda) y métricas de runtime del proceso.
 *   3. Se publica el estado de la capa de datos como métrica (glowapp_db_available /
 *      glowapp_db_degraded) para que una alerta pueda dispararse por degradación.
 *   4. Existen configuración de scraping y reglas de alerta de Prometheus.
 *
 * No usa red, base de datos ni credenciales: supertest contra `app` + lectura de archivos.
 */
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../index');

const BACKEND_ROOT = path.resolve(__dirname, '..');
const MONITORING_DIR = path.join(BACKEND_ROOT, 'monitoring');
const PROMETHEUS_YML = path.join(MONITORING_DIR, 'prometheus.yml');
const ALERTS_YML = path.join(MONITORING_DIR, 'alerts.yml');

/**
 * Extrae el valor de la primera muestra de una métrica cuyo nombre de familia coincide.
 * Devuelve NaN si no aparece.
 */
function valorDeMetrica(body, nombreFamilia) {
  const re = new RegExp(`^${nombreFamilia}(?:\\{[^}]*\\})?\\s+([0-9.eE+-]+)$`, 'm');
  const m = body.match(re);
  return m ? Number(m[1]) : NaN;
}

function exponeMetrica(body, nombreFamilia) {
  // Prometheus expone histogramas con sufijos _bucket, _sum, _count.
  // Aceptamos la familia base O cualquiera de sus sufijos.
  const re = new RegExp(`^${nombreFamilia}(?:_bucket|_sum|_count)?(?:\\{[^}]*\\})?(?:\\s|$)`, 'm');
  return re.test(body);
}

describe('P0 infra/observabilidad · Prometheus + health endpoint', () => {
  test('GET /metrics responde 200 con formato de exposición Prometheus, sin autenticación', async () => {
    const res = await request(app).get('/metrics').expect(200);

    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.headers['content-type']).toMatch(/version=0\.0\.4/);
    expect(typeof res.text).toBe('string');
    expect(res.text.length).toBeGreaterThan(0);
    // Un scraper no autentica: /metrics no puede exigir token.
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  test('expone la vitalidad del proceso y métricas de runtime (default metrics)', async () => {
    const res = await request(app).get('/metrics').expect(200);

    expect(exponeMetrica(res.text, 'glowapp_up')).toBe(true);
    expect(valorDeMetrica(res.text, 'glowapp_up')).toBe(1);
    // Métricas de proceso recolectadas por prom-client (prefijo glowapp_).
    expect(
      exponeMetrica(res.text, 'glowapp_process_cpu_user_seconds_total') ||
        exponeMetrica(res.text, 'glowapp_nodejs_eventloop_lag_seconds')
    ).toBe(true);
  });

  test('expone contador e histograma de peticiones HTTP con etiquetas de cardinalidad acotada', async () => {
    // El token único NUNCA debe aparecer como etiqueta: si lo hiciera, cada URL
    // distinta crearía una serie nueva y tumbaría Prometheus (cardinalidad infinita).
    const tokenInyectado = `noexiste_${Date.now()}_xyz`;

    await request(app).get('/api/health');
    await request(app).get(`/api/${tokenInyectado}?probe=${tokenInyectado}`);

    const res = await request(app).get('/metrics').expect(200);

    expect(exponeMetrica(res.text, 'glowapp_http_requests_total')).toBe(true);
    expect(exponeMetrica(res.text, 'glowapp_http_request_duration_seconds')).toBe(true);
    expect(exponeMetrica(res.text, 'glowapp_http_request_duration_seconds_bucket')).toBe(true);

    // La URL cruda (con su token/query) no debe ser una etiqueta.
    expect(res.text).not.toContain(tokenInyectado);

    // La ruta sana queda registrada y el contador es acumulativo (>= 1).
    expect(res.text).toMatch(/glowapp_http_requests_total\{[^}]*route="\/api\/health"[^}]*\}\s+[1-9]\d*/);
    const total = valorDeMetrica(res.text, 'glowapp_http_requests_total');
    expect(Number.isFinite(total)).toBe(true);
  });

  test('publica el estado de la capa de datos como métrica para alertar por degradación', async () => {
    const salud = await request(app).get('/api/health');
    expect([200, 503]).toContain(salud.status);
    expect(salud.body).toHaveProperty('status');

    const res = await request(app).get('/metrics').expect(200);

    expect(
      exponeMetrica(res.text, 'glowapp_db_available') || exponeMetrica(res.text, 'glowapp_db_degraded')
    ).toBe(true);

    // El invariante real es que la métrica NO mienta: tiene que coincidir con lo que
    // /api/health acaba de reportar. Antes se fijaba 0 asumiendo "en tests no hay
    // DATABASE_URL", pero el pipeline levanta un PostgreSQL real y ci.yml invierte la
    // precedencia para que la app lo sondee de verdad: la capa de datos SÍ está
    // disponible y un 0 hardcodeado sería justo la mentira que esta prueba caza.
    const degradadoSegunHealth = salud.body.status === 'DEGRADED';
    const saludComprobada = salud.body.status !== 'UNKNOWN';

    const disponible = valorDeMetrica(res.text, 'glowapp_db_available');
    if (Number.isFinite(disponible) && saludComprobada) {
      expect(disponible).toBe(degradadoSegunHealth ? 0 : 1);
    }
    const degradado = valorDeMetrica(res.text, 'glowapp_db_degraded');
    if (Number.isFinite(degradado) && saludComprobada) {
      expect(degradado).toBe(degradadoSegunHealth ? 1 : 0);
    }
  });

  test('define configuración de scraping de Prometheus contra /metrics', () => {
    expect(fs.existsSync(PROMETHEUS_YML)).toBe(true);
    const yml = fs.readFileSync(PROMETHEUS_YML, 'utf8').replace(/\r\n?/g, '\n');
    expect(yml).toMatch(/scrape_configs:/);
    expect(yml).toMatch(/metrics_path:\s*\/metrics/);
    expect(yml).toMatch(/job_name:/);
  });

  test('define reglas de alerta reales (no sólo el dashboard humano previo)', () => {
    expect(fs.existsSync(ALERTS_YML)).toBe(true);
    const yml = fs.readFileSync(ALERTS_YML, 'utf8').replace(/\r\n?/g, '\n');
    expect(yml).toMatch(/^groups:/m);
    expect(yml).toMatch(/^\s*-\s*alert:/m);
    const alertas = [...yml.matchAll(/^\s*-\s*alert:\s*(\S+)/gm)].map((m) => m[1]);
    // Debe cubrir caída del proceso, tasa de error y degradación de la capa de datos.
    expect(alertas.length).toBeGreaterThanOrEqual(3);
    expect(yml).toMatch(/glowapp_up/);
    expect(yml).toMatch(/glowapp_http_requests_total/);
    expect(yml).toMatch(/glowapp_db_(available|degraded)/);
    expect(yml).toMatch(/expr:/);
  });
});

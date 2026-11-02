/**
 * backend/src/tests/contract/openapi.contract.test.js
 *
 * FIX-FLUTTER-09 (P1) — Contract testing OpenAPI.
 *
 * HALLAZGO: el backend exponía ~250 operaciones bajo /api, pero el único origen
 * de contrato del repo (swagger-jsdoc sobre ./src/routes/*.js) documentaba 2
 * rutas. No había ninguna verificación automática de que el contrato declarado
 * cubriera lo que la API monta de verdad, así que cualquier deriva de API
 * (endpoint nuevo, ruta renombrada, método cambiado) pasaba desapercibida hasta
 * romper al cliente Flutter en producción.
 *
 * Este test es la COMPUERTA: compara el artefacto versionado
 * (backend/openapi/openapi.json) contra el stack de Express en ejecución.
 *
 *   C1 el artefacto de contrato existe
 *   C2 el contrato cubre el 100% de las operaciones montadas bajo /api
 *   C3 no hay rutas declaradas que ya no existan (contrato obsoleto)
 *   C4 el artefacto está en sincronía con el generador (compuerta de deriva:
 *      un cambio de API sin regenerar el contrato pone el CI en rojo)
 *   C5 las operaciones críticas (auth, booking, payment, admin) tienen contrato
 *      explícito, no un stub autodescubierto
 *   C6 no aparecen operaciones duplicadas nuevas
 *   C7 CONTROL POSITIVO: la comparación detecta de verdad una eliminación de
 *      operación del contrato (la compuerta no es un sello de goma)
 *   C8 el artefacto es un documento OpenAPI 3.0 válido y completo
 */

process.env.NODE_ENV = 'test';

const fs = require('fs');
const path = require('path');

const app = require('../../../index');
const { toOpenApiPath } = require('../../openapi/routeInventory');
const { compareSpecToApp } = require('../../openapi/verifySpecAgainstApp');
const {
  CRITICAL_OPERATION_KEYS,
  KNOWN_DUPLICATE_OPERATIONS,
} = require('../../openapi/criticalContract');

const BACKEND_ROOT = path.join(__dirname, '..', '..', '..');
const SPEC_PATH = path.join(BACKEND_ROOT, 'openapi', 'openapi.json');
const GENERATOR_PATH = path.join(BACKEND_ROOT, 'src', 'openapi', 'buildOpenApi.js');

function readSpec() {
  return JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
}

function buildReport(spec) {
  return compareSpecToApp(spec, app, {
    criticalOperations: CRITICAL_OPERATION_KEYS,
    knownDuplicates: KNOWN_DUPLICATE_OPERATIONS,
  });
}

function logList(title, list, max = 40) {
  if (!list.length) return;
  // eslint-disable-next-line no-console
  console.error(
    `[CONTRATO OPENAPI] ${title} (${list.length}):\n` +
      list.slice(0, max).join('\n') +
      (list.length > max ? `\n… y ${list.length - max} más` : '')
  );
}

describe('FIX-FLUTTER-09 — Contrato OpenAPI ↔ rutas reales del backend', () => {
  let spec = null;
  let report = null;

  beforeAll(() => {
    try {
      spec = readSpec();
      report = buildReport(spec);
    } catch (err) {
      spec = null;
      report = null;
    }
  });

  test('C1: el contrato OpenAPI versionado existe (backend/openapi/openapi.json)', () => {
    const exists = fs.existsSync(SPEC_PATH);
    if (!exists) {
      // eslint-disable-next-line no-console
      console.error(
        `[CONTRATO OPENAPI] Falta el artefacto de contrato en ${SPEC_PATH}.\n` +
          'Generarlo con: npm run openapi:generate'
      );
    }
    expect(exists).toBe(true);
  });

  test('C2: el contrato cubre el 100% de las operaciones montadas bajo /api', () => {
    expect(report).not.toBeNull();
    logList('Operaciones montadas SIN contrato', report.missing);
    expect({
      total: report.total,
      covered: report.covered,
      coveragePct: report.coveragePct,
    }).toEqual({ total: report.total, covered: report.total, coveragePct: 100 });
  });

  test('C3: no hay rutas declaradas en el contrato que ya no estén montadas', () => {
    expect(report).not.toBeNull();
    logList('Rutas declaradas y NO montadas (contrato obsoleto)', report.orphan);
    expect(report.orphan).toEqual([]);
  });

  test('C4: el artefacto está en sincronía con el generador (compuerta de deriva)', () => {
    if (!fs.existsSync(GENERATOR_PATH)) {
      throw new Error(
        `Falta el generador del contrato en ${GENERATOR_PATH}. Sin él no hay forma de ` +
          'volver a derivar el contrato desde el código, y la compuerta de deriva es decorativa.'
      );
    }
    // Import a propósito dentro del test: el resto de casos debe poder ejecutarse
    // y dar un diagnóstico útil aunque el generador no exista todavía.
    // eslint-disable-next-line global-require
    const { buildOpenApiDocument, serializeSpec } = require('../../openapi/buildOpenApi');

    const regenerated = serializeSpec(buildOpenApiDocument(app));
    const committed = serializeSpec(spec);

    if (regenerated !== committed) {
      const fresh = JSON.parse(regenerated);
      const freshReport = buildReport(fresh);
      logList('Deriva detectada — operaciones sin contrato en el artefacto versionado', freshReport.missing);
      logList('Deriva detectada — rutas del artefacto que ya no existen', freshReport.orphan);
    }

    expect(regenerated).toBe(committed);
  });

  test('C5: las operaciones críticas (auth/booking/payment/admin) tienen contrato explícito', () => {
    expect(report).not.toBeNull();
    expect(spec).not.toBeNull();
    expect(CRITICAL_OPERATION_KEYS.length).toBeGreaterThanOrEqual(8);
    logList('Operaciones críticas SIN contrato explícito', report.undocumentedCritical);
    logList('Operaciones críticas declaradas que no existen en el código', report.absentCritical);
    expect(report.undocumentedCritical).toEqual([]);
    expect(report.absentCritical).toEqual([]);

    // Cada operación crítica debe declarar sus respuestas con esquema o descripción.
    CRITICAL_OPERATION_KEYS.forEach((key) => {
      const [method, openapiPath] = key.split(' ');
      const operation = spec.paths[openapiPath] && spec.paths[openapiPath][method.toLowerCase()];
      expect(operation).toBeDefined();
      expect(Object.keys(operation.responses || {}).length).toBeGreaterThanOrEqual(2);
      Object.entries(operation.responses).forEach(([status, response]) => {
        expect(typeof response.description).toBe('string');
        expect(response.description.length).toBeGreaterThan(3);
        expect(status === 'default').toBe(false);
      });
    });
  });

  test('C6: no aparecen operaciones duplicadas nuevas en el enrutamiento', () => {
    expect(report).not.toBeNull();
    logList('Operaciones duplicadas NUEVAS', report.newDuplicates);
    expect(report.newDuplicates).toEqual([]);
  });

  test('C7: control positivo — la compuerta detecta una operación eliminada del contrato', () => {
    expect(spec).not.toBeNull();
    // Mutación controlada sobre una COPIA del contrato: si el detector no ve la
    // eliminación, la compuerta sería decorativa.
    const mutated = JSON.parse(JSON.stringify(spec));
    const removedKey = 'GET /api/bookings/client';
    const [removedMethod, removedPath] = removedKey.split(' ');
    delete mutated.paths[removedPath][removedMethod.toLowerCase()];

    const mutatedReport = compareSpecToApp(mutated, app, {
      criticalOperations: CRITICAL_OPERATION_KEYS,
      knownDuplicates: KNOWN_DUPLICATE_OPERATIONS,
    });
    expect(mutatedReport.missing).toContain(removedKey);
    expect(mutatedReport.ok).toBe(false);

    // Y también detecta una ruta declarada que ya no existe en el código.
    const withOrphan = JSON.parse(JSON.stringify(spec));
    withOrphan.paths['/api/ruta-fantasma-del-contrato'] = {
      get: { summary: 'ruta inventada', responses: { 200: { description: 'x' } } },
    };
    const orphanReport = compareSpecToApp(withOrphan, app, {
      criticalOperations: CRITICAL_OPERATION_KEYS,
      knownDuplicates: KNOWN_DUPLICATE_OPERATIONS,
    });
    expect(orphanReport.orphan).toContain('GET /api/ruta-fantasma-del-contrato');

    // Sanity check del propio instrumento de medida: la conversión de parámetros
    // de Express (:id) a la notación OpenAPI ({id}) es correcta.
    expect(toOpenApiPath('/api/providers/:id')).toBe('/api/providers/{id}');
  });

  test('C8: el artefacto es un documento OpenAPI 3.0 válido y completo', () => {
    expect(spec).not.toBeNull();
    expect(spec.openapi).toBe('3.0.0');
    expect(spec.info && spec.info.title).toBeTruthy();
    expect(spec.info && spec.info.version).toBeTruthy();
    expect(Array.isArray(spec.servers) && spec.servers.length).toBeGreaterThan(0);
    expect(spec.paths && Object.keys(spec.paths).length).toBeGreaterThan(0);
    expect(
      spec.components && spec.components.securitySchemes && spec.components.securitySchemes.bearerAuth
    ).toBeDefined();
    // Toda operación declara al menos una respuesta.
    Object.entries(spec.paths).forEach(([p, item]) => {
      ['get', 'post', 'put', 'patch', 'delete'].forEach((verb) => {
        if (item[verb]) {
          expect(Object.keys(item[verb].responses || {}).length).toBeGreaterThan(0);
        }
      });
    });
  });
});

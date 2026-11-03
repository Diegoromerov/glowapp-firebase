'use strict';

/**
 * E-01 (D-GL-027) — compuerta de montaje de los routers huérfanos.
 *
 * HALLAZGO: `ownerRoutes` e `inventoryRoutes` existían con controlador y tests,
 * pero nunca se montaron en `index.js`. Producción respondía 404 mientras el
 * cliente ya llamaba `/api/owner/*` y `/api/provider/inventory/*`.
 *
 * Este test exige el stack REAL (`../../../index`), no una app sintética: si
 * alguien borra el `app.use`, el 401 vuelve a ser 404 y la prueba cae. Un test
 * que monta el router por su cuenta no detecta esa regresión.
 *
 * Vive en `src/tests/contract/` a propósito: requiere `index.js`, que deja
 * handles abiertos (cron, pool), así que corre en el paso de contrato con
 * `--forceExit` y queda fuera del gate general de jest, igual que las otras
 * dos compuertas de contrato.
 */

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../../../index');

// Header requerido por validateAppAudience global (Fase 4)
const PROVIDER_AUDIENCE_HEADER = { 'X-App-Audience': 'provider' };

describe('E-01 — routers publicados en la app real (D-GL-027)', () => {
  const rutas = [
    ['get', '/api/owner/salones'],
    ['post', '/api/owner/switch-salon'],
    ['get', '/api/owner/dashboard-metrics'],
    ['get', '/api/provider/inventory/consignment'],
    ['post', '/api/provider/inventory/consume'],
  ];

  test.each(rutas)('%s %s responde 401 (montado y protegido, no 404)', async (method, ruta) => {
    const res = await request(app)[method](ruta).set(PROVIDER_AUDIENCE_HEADER);
    expect(res.status).toBe(401);
  });

  test('el slug viejo /api/inventory/consignacion no queda publicado', async () => {
    const res = await request(app).get('/api/inventory/consignacion').set(PROVIDER_AUDIENCE_HEADER);
    expect(res.status).toBe(404);
  });

  test('el prefijo versionado /api/v1/owner no se publica por accidente', async () => {
    const res = await request(app).get('/api/v1/owner/salones').set(PROVIDER_AUDIENCE_HEADER);
    expect(res.status).toBe(404);
  });
});

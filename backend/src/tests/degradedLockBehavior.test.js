const request = require('supertest');
const app = require('../../index');
const db = require('../config/db');

describe('Cargo 1 / C6 — Comportamiento de Bloqueo por Degradación en la Capa de Datos', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('C6: Superficie de datos (/api/products) responde 503 + X-GlowApp-Degraded cuando la base está degradada', async () => {
    // memoryFallbackAllowed: false es lo que DEFINE el bloqueo. La regla del candado
    // (degradedLock.js:141-143) es:
    //   blocked = (pgAvailable === false || servingFabricatedData === true) &&
    //             (!memoryFallbackAllowed || isStrict)
    // El fixture anterior declaraba memoryFallbackAllowed: true -> blocked = false por diseño
    // (y es correcto: con el fallback permitido la app sirve desde el emulador, que es lo que
    // hacen todas las demas suites). Declarar el fallback permitido y exigir el bloqueo era
    // contradecir en el fixture el escenario que el nombre del test anuncia.
    // Decision de Diego: el candado tiene razon, sirve desde memoria; el fixture declara el
    // estado que bloquea para ejercer de verdad la superficie de datos.
    jest.spyOn(db, 'getDbStatus').mockReturnValue({
      pgAvailable: false,
      servingFabricatedData: true,
      memoryFallbackAllowed: false
    });

    const res = await request(app).get('/api/products');

    expect(res.status).toBe(503);
    expect(res.headers['x-glowapp-degraded']).toBe('memory-fallback');
    expect(res.body).toHaveProperty('error', 'DATA_LAYER_DEGRADED');
  });

  test('C6: Ruta exenta (/api/health) responde 503 con estado DEGRADED propio cuando la base está degradada', async () => {
    jest.spyOn(db, 'getDbStatus').mockReturnValue({
      pgAvailable: false,
      servingFabricatedData: true,
      memoryFallbackAllowed: true
    });

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body).toHaveProperty('status', 'DEGRADED');
  });

  test('C6: Ruta exenta (/api/providers) responde 503 con PROVIDER_SEARCH_DEGRADED propio cuando la base está degradada', async () => {
    jest.spyOn(db, 'getDbStatus').mockReturnValue({
      pgAvailable: false,
      servingFabricatedData: true,
      memoryFallbackAllowed: true
    });

    const res = await request(app).get('/api/providers');

    expect(res.status).toBe(503);
    expect(res.body).toHaveProperty('error', 'PROVIDER_SEARCH_DEGRADED');
  });

  test('C6: Superficie de datos responde normalmente sin 503 (DATA_LAYER_DEGRADED) cuando la capa de datos no está degradada', async () => {
    jest.spyOn(db, 'getDbStatus').mockReturnValue({
      pgAvailable: true,
      servingFabricatedData: false,
      memoryFallbackAllowed: false
    });

    const res = await request(app).get('/api/products');

    // Antes esta aserción se satisfacía con CUALQUIER cosa que no fuera 503: mientras el
    // emulador estuvo incompleto el controlador devolvía 500 y el test pasaba igual, sin medir
    // nada. La respuesta real medida es 200 + { success, count, data }.
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

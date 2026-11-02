/**
 * ORDEN A · FASE A RONDA 7 (O-013) — «sin comprobar no es lo mismo que sano»
 *
 * El candado no puede decidir con un estado que nunca se comprobó. Cuando `pgAvailable === null`
 * (proceso que sirvió sin ejecutar el arranque real: `require('./index')` sin `app.listen`),
 * el candado debe PROVOCAR la comprobación una vez (con caché acotada) y decidir con el resultado:
 *   - comprobación exitosa  ⇒ NO bloquea (la ruta decide; sano ⇒ 200)
 *   - comprobación fallida  ⇒ bloquea con 503 DATA_LAYER_DEGRADED (como hoy con estado degradado)
 * No se vuelve a «bloquear a ciegas cuando es null» (eso reintroduciría el falso DEGRADED con
 * la base sana que cerró CI-20).
 *
 * `jest.resetModules()` en cada caso: el caché de comprobación es estado del módulo.
 */
let db;
let degradedLockMiddleware;

beforeEach(() => {
  jest.resetModules();
  db = require('../config/db');
  ({ degradedLockMiddleware } = require('../middleware/degradedLock'));
});

afterEach(() => jest.restoreAllMocks());

function fakeReq(path = '/api/products') {
  return { originalUrl: path, url: path, method: 'GET' };
}

function correr(path = '/api/products') {
  const req = fakeReq(path);
  const res = { statusCode: 200, headers: {}, body: null };
  return new Promise((resolve) => {
    const done = (paso) => resolve({ paso, status: res.statusCode, res });
    res.setHeader = (k, v) => { res.headers[k] = v; return res; };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; done('respuesta'); return res; };
    const next = () => done('next');
    const out = degradedLockMiddleware(req, res, next);
    if (out && typeof out.then === 'function') out.catch(() => done('error'));
  });
}

const DESCONOCIDO = { pgAvailable: null, servingFabricatedData: false, dbMode: 'indefinido' };
const SANO = { pgAvailable: true, servingFabricatedData: false, dbMode: 'postgres' };
const CAIDO = { pgAvailable: false, servingFabricatedData: false, dbMode: 'postgres' };

describe('ORDEN A · RONDA 7 — el candado comprueba cuando desconoce', () => {
  test('(a) sin comprobar + la comprobación sale sana ⇒ comprueba y deja pasar', async () => {
    const getDbStatus = jest.spyOn(db, 'getDbStatus').mockReturnValue(DESCONOCIDO);
    const testConnection = jest.spyOn(db, 'testConnection').mockImplementation(async () => {
      getDbStatus.mockReturnValue(SANO);
      return true;
    });

    const r = await correr();
    expect(testConnection).toHaveBeenCalled();
    expect(r.paso).toBe('next');
  });

  test('(b) sin comprobar + la comprobación falla ⇒ bloquea 503 DATA_LAYER_DEGRADED', async () => {
    const getDbStatus = jest.spyOn(db, 'getDbStatus').mockReturnValue(DESCONOCIDO);
    const testConnection = jest.spyOn(db, 'testConnection').mockImplementation(async () => {
      getDbStatus.mockReturnValue(CAIDO);
      return false;
    });

    const r = await correr();
    expect(testConnection).toHaveBeenCalled();
    expect(r.paso).toBe('respuesta');
    expect(r.status).toBe(503);
    expect(r.res.headers['X-GlowApp-Degraded']).toBe('memory-fallback');
    expect(r.res.body.error).toBe('DATA_LAYER_DEGRADED');
  });

  test('(c) caché acotada: varias peticiones seguidas ⇒ exactamente UNA comprobación', async () => {
    const getDbStatus = jest.spyOn(db, 'getDbStatus').mockReturnValue(DESCONOCIDO);
    const testConnection = jest.spyOn(db, 'testConnection').mockImplementation(async () => {
      getDbStatus.mockReturnValue(SANO);
      return true;
    });

    await correr(); await correr(); await correr();
    expect(testConnection.mock.calls.length).toBe(1);
  });

  test('(d) estado ya comprobado y sano ⇒ no vuelve a comprobar', async () => {
    const testConnection = jest.spyOn(db, 'testConnection').mockResolvedValue(true);
    jest.spyOn(db, 'getDbStatus').mockReturnValue(SANO);

    const r = await correr();
    expect(testConnection).not.toHaveBeenCalled();
    expect(r.paso).toBe('next');
  });

  test('(e) la allowlist motivada sigue exenta aunque la comprobación falle', async () => {
    const getDbStatus = jest.spyOn(db, 'getDbStatus').mockReturnValue(DESCONOCIDO);
    jest.spyOn(db, 'testConnection').mockImplementation(async () => {
      getDbStatus.mockReturnValue(CAIDO);
      return false;
    });

    const r = await correr('/api/health');
    expect(r.paso).toBe('next');
  });

  test('(f) si la comprobación explota, NO se inventa estado: se decide con lo que hay', async () => {
    const getDbStatus = jest.spyOn(db, 'getDbStatus').mockReturnValue(DESCONOCIDO);
    jest.spyOn(db, 'testConnection').mockImplementation(async () => { throw new Error('boom'); });

    const r = await correr();
    expect(getDbStatus).toHaveBeenCalled();
    expect(r.paso).toBe('next'); // sigue desconocido ⇒ no bloquea a ciegas
  });
});

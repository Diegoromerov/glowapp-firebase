const db = require('../config/db');
const { degradedLockMiddleware, DEGRADED_ALLOWLIST } = require('../middleware/degradedLock');

describe('CI-16 — Contrato de alcance del candado degradado', () => {
  let originalGetDbStatus;
  let originalTestConnection;

  beforeAll(() => {
    originalGetDbStatus = db.getDbStatus;
    originalTestConnection = db.testConnection;
  });

  afterAll(() => {
    db.getDbStatus = originalGetDbStatus;
    db.testConnection = originalTestConnection;
  });

  describe('1. La allowlist no puede incluir rutas de dinero o identidad ni comodines', () => {
    test('ninguna ruta en DEGRADED_ALLOWLIST pertenece a dinero/identidad ni contiene *', () => {
      for (const ruta of DEGRADED_ALLOWLIST) {
        expect(/(auth|payment|wallet|booking|dispute|ticket|admin|order|refund)/i.test(ruta)).toBe(false);
        expect(ruta.includes('*')).toBe(false);
      }
    });
  });

  describe('2. Las 3 rutas exentas permanecen exentas en la allowlist', () => {
    test('contiene exactamente las 3 rutas exentas autorizadas', () => {
      expect(DEGRADED_ALLOWLIST.has('/api/health')).toBe(true);
      expect(DEGRADED_ALLOWLIST.has('/api/providers')).toBe(true);
      expect(DEGRADED_ALLOWLIST.has('/api/test-db')).toBe(true);
      expect(DEGRADED_ALLOWLIST.size).toBe(3);
    });

    test('las rutas exentas no son bloqueadas por degradedLockMiddleware aun en estado degradado', async () => {
      db.getDbStatus = () => ({ pgAvailable: false, servingFabricatedData: true });
      db.testConnection = async () => {};

      const exentas = ['/api/health', '/api/providers', '/api/test-db'];
      for (const url of exentas) {
        const req = { url, originalUrl: url };
        let nextCalled = false;
        const next = () => { nextCalled = true; };
        const res = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };

        await degradedLockMiddleware(req, res, next);
        expect(nextCalled).toBe(true);
        expect(res.setHeader).not.toHaveBeenCalled();
      }
    });
  });

  describe('3. Bloqueo estricto de superficies de dinero e identidad en estado degradado', () => {
    const rutasSensibles = [
      { method: 'POST', url: '/api/auth/login' },
      { method: 'POST', url: '/api/auth/register' },
      { method: 'POST', url: '/api/auth/verify-otp' },
      { method: 'POST', url: '/api/payments/wompi-webhook' },
      { method: 'GET', url: '/api/bookings' },
      { method: 'GET', url: '/api/wallet/balance' },
      { method: 'GET', url: '/api/disputes' }
    ];

    test('bloquea con 503 y setea X-GlowApp-Degraded cuando servingFabricatedData es true', async () => {
      db.getDbStatus = () => ({ pgAvailable: false, servingFabricatedData: true });
      db.testConnection = async () => {};

      for (const { url } of rutasSensibles) {
        const req = { url, originalUrl: url };
        let nextCalled = false;
        const next = () => { nextCalled = true; };
        const resHeaders = {};
        let responseStatus = null;
        let responseBody = null;

        const res = {
          setHeader: (k, v) => { resHeaders[k] = v; },
          status: (code) => {
            responseStatus = code;
            return {
              json: (data) => { responseBody = data; }
            };
          }
        };

        await degradedLockMiddleware(req, res, next);

        expect(nextCalled).toBe(false);
        expect(responseStatus).toBe(503);
        expect(resHeaders['X-GlowApp-Degraded']).toBe('memory-fallback');
        expect(responseBody).toEqual({
          success: false,
          error: 'DATA_LAYER_DEGRADED',
          message: 'Servicio no disponible en modo degradado sin conexión a la base de datos'
        });
      }
    });

    test('bloquea con 503 y setea X-GlowApp-Degraded cuando pgAvailable es false', async () => {
      db.getDbStatus = () => ({ pgAvailable: false, servingFabricatedData: false });
      db.testConnection = async () => {};

      for (const { url } of rutasSensibles) {
        const req = { url, originalUrl: url };
        let nextCalled = false;
        const next = () => { nextCalled = true; };
        const resHeaders = {};
        let responseStatus = null;

        const res = {
          setHeader: (k, v) => { resHeaders[k] = v; },
          status: (code) => {
            responseStatus = code;
            return { json: jest.fn() };
          }
        };

        await degradedLockMiddleware(req, res, next);

        expect(nextCalled).toBe(false);
        expect(responseStatus).toBe(503);
        expect(resHeaders['X-GlowApp-Degraded']).toBe('memory-fallback');
      }
    });

    test('NO bloquea (llama a next) cuando el estado es UNCHECKED (pgAvailable: null, sin datos fabricados)', async () => {
      db.getDbStatus = () => ({ pgAvailable: null, servingFabricatedData: false });
      db.testConnection = async () => {};

      for (const { url } of rutasSensibles) {
        const req = { url, originalUrl: url };
        let nextCalled = false;
        const next = () => { nextCalled = true; };
        const res = { setHeader: jest.fn(), status: jest.fn() };

        await degradedLockMiddleware(req, res, next);

        expect(nextCalled).toBe(true);
        expect(res.setHeader).not.toHaveBeenCalled();
      }
    });
  });
});

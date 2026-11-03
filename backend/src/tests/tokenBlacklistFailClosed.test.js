// backend/src/tests/tokenBlacklistFailClosed.test.js
const jwt = require('jsonwebtoken');
const { authMiddleware } = require('../middleware/auth');
const redisClient = require('../config/redis');

describe('FASE 2 — Fail-Closed en blacklist de tokens (Redis)', () => {
  let req, res, next;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    req = {
      header: jest.fn().mockReturnValue('Bearer test.jwt.token'),
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    jest.restoreAllMocks();
  });

  test('en producción (NODE_ENV=production) si Redis está caído devuelve HTTP 503 (Fail-Closed)', async () => {
    process.env.NODE_ENV = 'production';
    // Forzar Redis deshabilitado / isReady = false
    const origReady = redisClient.isReady;
    redisClient.isReady = false;

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('no disponible') })
    );
    expect(next).not.toHaveBeenCalled();

    redisClient.isReady = origReady;
  });

  test('en desarrollo si Redis está caído permite continuar (Fail-Open con advertencia)', async () => {
    process.env.NODE_ENV = 'development';
    const origReady = redisClient.isReady;
    redisClient.isReady = false;

    // Spy console.warn
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    // jwt.verify fallará por token sintético, pero NO dará 503 de Redis
    await authMiddleware(req, res, next);

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Redis deshabilitado en dev/test')
    );
    expect(res.status).not.toHaveBeenCalledWith(503);

    redisClient.isReady = origReady;
  });
});

// backend/src/tests/tokenBlacklistFailClosedDefault.test.js
/**
 * AUD-INFRA-01 #14 — «Token blacklist fail-open en Redis failure» (P0).
 *
 * Invariante: la comprobación del blacklist de tokens es FAIL-CLOSED POR DEFECTO.
 * Sólo se permite obviarla (fail-open con advertencia) cuando NODE_ENV es
 * EXPLÍCITAMENTE 'development' o 'test'. Cualquier otro valor — incluido
 * NODE_ENV ausente, 'staging' o un typo — debe rechazar con 503 y NO llamar next().
 *
 * Antes del fix, el guard usaba `NODE_ENV === 'production'` como única condición
 * de cierre: un despliegue con NODE_ENV mal configurado quedaba fail-open y los
 * tokens revocados seguían funcionando.
 */
const { authMiddleware } = require('../middleware/auth');
const redisClient = require('../config/redis');

describe('FASE C — Blacklist de tokens fail-closed POR DEFECTO (AUD-INFRA-01 #14)', () => {
  let req, res, next;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    req = { header: jest.fn().mockReturnValue('Bearer test.jwt.token') };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
    jest.restoreAllMocks();
  });

  test('NODE_ENV ausente + Redis caído → 503 fail-closed, next() NO se llama', async () => {
    delete process.env.NODE_ENV;
    const origReady = redisClient.isReady;
    redisClient.isReady = false;

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();

    redisClient.isReady = origReady;
  });

  test('NODE_ENV=staging + Redis caído → 503 fail-closed, next() NO se llama', async () => {
    process.env.NODE_ENV = 'staging';
    const origReady = redisClient.isReady;
    redisClient.isReady = false;

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();

    redisClient.isReady = origReady;
  });

  test('Redis disponible pero get() lanza + NODE_ENV ausente → 503 fail-closed', async () => {
    delete process.env.NODE_ENV;
    const origReady = redisClient.isReady;
    redisClient.isReady = true;
    jest.spyOn(redisClient, 'get').mockRejectedValue(new Error('connection lost'));

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();

    redisClient.isReady = origReady;
  });

  test('NODE_ENV=development + Redis caído → fail-open explícito (advertencia)', async () => {
    process.env.NODE_ENV = 'development';
    const origReady = redisClient.isReady;
    redisClient.isReady = false;
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await authMiddleware(req, res, next);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Redis deshabilitado en dev/test')
    );
    expect(res.status).not.toHaveBeenCalledWith(503);

    redisClient.isReady = origReady;
  });
});

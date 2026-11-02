/**
 * backend/src/tests/rateLimiter.test.js
 * Tests unitarios para rateLimiter.js
 */

const { 
  rateLimitByUser, 
  rateLimitByIP, 
  checkRateLimit, 
  resetRateLimit,
  getRedisClient,
  isRedisAvailable,
  TIER_LIMITS,
  GLOBAL_IP_LIMIT
} = require('../middleware/rateLimiter');

// Mock Redis
jest.mock('redis', () => ({
  createClient: () => ({
    connect: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    zRemRangeByScore: jest.fn().mockReturnThis(),
    zCard: jest.fn().mockResolvedValue(0),
    zAdd: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    multi: () => ({
      zRemRangeByScore: jest.fn().mockReturnThis(),
      zCard: jest.fn().mockReturnThis(),
      zAdd: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, 0], [null, 0], [null, 'ok'], [null, true]]),
    }),
    zRange: jest.fn().mockResolvedValue([]),
    del: jest.fn().mockResolvedValue(1),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    setEx: jest.fn().mockResolvedValue('OK'),
    zRemRangeByScore: jest.fn().mockResolvedValue(0),
    zCard: jest.fn().mockResolvedValue(0),
  }),
}));

describe('rateLimiter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('TIER_LIMITS', () => {
    test('debe tener límites correctos por tier', () => {
      expect(TIER_LIMITS.free).toEqual({ requests: 30, windowMs: 60000 });
      expect(TIER_LIMITS.premium).toEqual({ requests: 100, windowMs: 60000 });
      expect(TIER_LIMITS.anonymous).toEqual({ requests: 10, windowMs: 60000 });
    });
  });

  describe('GLOBAL_IP_LIMIT', () => {
    test('debe tener límite global por IP', () => {
      expect(GLOBAL_IP_LIMIT).toEqual({ requests: 200, windowMs: 60000 });
    });
  });

  describe('getTierLimit', () => {
    test('debe retornar límite correcto para tier conocido', () => {
      const { getTierLimit } = require('../middleware/rateLimiter');
      expect(getTierLimit('free')).toEqual({ requests: 30, windowMs: 60000 });
      expect(getTierLimit('premium')).toEqual({ requests: 100, windowMs: 60000 });
      expect(getTierLimit('anonymous')).toEqual({ requests: 10, windowMs: 60000 });
    });

    test('debe retornar límite free por defecto', () => {
      const { getTierLimit } = require('../middleware/rateLimiter');
      expect(getTierLimit('unknown')).toEqual({ requests: 30, windowMs: 60000 });
    });
  });

  describe('rateLimitByUser middleware', () => {
    test('debe crear middleware sin errores', () => {
      const middleware = rateLimitByUser({ tier: 'free' });
      expect(typeof middleware).toBe('function');
    });

    test('debe crear middleware con tier premium', () => {
      const middleware = rateLimitByUser({ tier: 'premium' });
      expect(typeof middleware).toBe('function');
    });

    test('debe crear middleware con límite personalizado', () => {
      const middleware = rateLimitByUser({ customLimit: { requests: 50, windowMs: 30000 } });
      expect(typeof middleware).toBe('function');
    });
  });

  describe('rateLimitByIP middleware', () => {
    test('debe crear middleware sin errores', () => {
      const middleware = rateLimitByIP({ limit: 10, windowMs: 60000 });
      expect(typeof middleware).toBe('function');
    });

    test('debe usar límites por defecto', () => {
      const middleware = rateLimitByIP();
      expect(typeof middleware).toBe('function');
    });
  });

  describe('checkRateLimit', () => {
    test('debe retornar objeto con allowed, remaining, resetAt', async () => {
      const result = await checkRateLimit('test-user', 'free');
      expect(result).toHaveProperty('allowed');
      expect(result).toHaveProperty('remaining');
      expect(result).toHaveProperty('resetAt');
      expect(result).toHaveProperty('total');
    });
  });

  describe('resetRateLimit', () => {
    test('debe ejecutarse sin errores', async () => {
      await expect(resetRateLimit('test-user')).resolves.not.toThrow();
      await expect(resetRateLimit('test-user', 'free')).resolves.not.toThrow();
      await expect(resetRateLimit('test-user', 'all')).resolves.not.toThrow();
    });
  });

  describe('isRedisAvailable', () => {
    test('debe retornar boolean', () => {
      const result = isRedisAvailable();
      expect(typeof result).toBe('boolean');
    });
  });
});
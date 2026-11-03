/**
 * backend/src/tests/abuseDetection.test.js
 * Tests unitarios para abuseDetection.js
 */

const { 
  trackAbuse, 
  isBlocked, 
  getAbuseReport, 
  trackLargePayload,
  trackFastRequests,
  clearAbuseRecord,
  abuseDetectionMiddleware,
  ABUSE_THRESHOLDS
} = require('../services/abuseDetection');

// Mock Redis
jest.mock('redis', () => ({
  createClient: () => ({
    connect: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    setEx: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    exists: jest.fn().mockResolvedValue(0),
    zAdd: jest.fn().mockResolvedValue(1),
    zCard: jest.fn().mockResolvedValue(0),
    zRangeByScore: jest.fn().mockResolvedValue([]),
    zRange: jest.fn().mockResolvedValue([]),
    zRemRangeByScore: jest.fn().mockResolvedValue(0),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(true),
    multi: () => ({
      zAdd: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      incr: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, 1], [null, true], [null, 1], [null, true]]),
    }),
  }),
}));

describe('abuseDetection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ABUSE_THRESHOLDS', () => {
    test('debe tener umbrales correctos', () => {
      expect(ABUSE_THRESHOLDS.suspiciousLimit).toBe(5);
      expect(ABUSE_THRESHOLDS.blockLimit).toBe(10);
      expect(ABUSE_THRESHOLDS.windowMs).toBe(10 * 60 * 1000);
      expect(ABUSE_THRESHOLDS.blockDurationMs).toBe(30 * 60 * 1000);
      expect(ABUSE_THRESHOLDS.maxBlockDurationMs).toBe(24 * 60 * 60 * 1000);
      expect(ABUSE_THRESHOLDS.maxPayloadSize).toBe(10 * 1024);
      expect(ABUSE_THRESHOLDS.minRequestInterval).toBe(1000);
    });
  });

  describe('trackAbuse', () => {
    test('debe retornar objeto con suspicious, blocked, blockUntil', async () => {
      const result = await trackAbuse('test-user', 'rate_limit_exceeded');
      expect(result).toHaveProperty('suspicious');
      expect(result).toHaveProperty('blocked');
      expect(result).toHaveProperty('blockUntil');
    });

    test('debe manejar userId null/undefined', async () => {
      const result1 = await trackAbuse(null, 'rate_limit_exceeded');
      const result2 = await trackAbuse(undefined, 'rate_limit_exceeded');
      
      expect(result1.suspicious).toBe(false);
      expect(result1.blocked).toBe(false);
      expect(result2.suspicious).toBe(false);
      expect(result2.blocked).toBe(false);
    });
  });

  describe('isBlocked', () => {
    test('debe retornar objeto con blocked y blockUntil', async () => {
      const result = await isBlocked('test-user');
      expect(result).toHaveProperty('blocked');
      expect(result).toHaveProperty('blockUntil');
    });

    test('debe retornar false para userId null', async () => {
      const result = await isBlocked(null);
      expect(result.blocked).toBe(false);
      expect(result.blockUntil).toBeNull();
    });
  });

  describe('getAbuseReport', () => {
    test('debe retornar reporte con estructura correcta', async () => {
      const report = await getAbuseReport('test-user');
      expect(report).toHaveProperty('events');
      expect(report).toHaveProperty('counts');
      expect(report).toHaveProperty('totalEvents');
      expect(report).toHaveProperty('suspicious');
      expect(report).toHaveProperty('blocked');
      expect(report).toHaveProperty('blockUntil');
      expect(report).toHaveProperty('windowMs');
    });

    test('debe manejar userId null', async () => {
      const report = await getAbuseReport(null);
      expect(report.events).toEqual([]);
      expect(report.counts).toEqual({});
      expect(report.totalEvents).toBe(0);
    });
  });

  describe('trackLargePayload', () => {
    test('debe ejecutarse sin errores para payload grande', async () => {
      await expect(trackLargePayload('test-user', 15 * 1024)).resolves.not.toThrow();
    });

    test('no debe hacer nada para payload pequeño', async () => {
      await expect(trackLargePayload('test-user', 5 * 1024)).resolves.not.toThrow();
    });
  });

  describe('trackFastRequests', () => {
    test('debe ejecutarse sin errores', async () => {
      await expect(trackFastRequests('test-user')).resolves.not.toThrow();
    });

    test('debe manejar userId null', async () => {
      await expect(trackFastRequests(null)).resolves.not.toThrow();
    });
  });

  describe('clearAbuseRecord', () => {
    test('debe ejecutarse sin errores', async () => {
      await expect(clearAbuseRecord('test-user')).resolves.not.toThrow();
    });
  });

  describe('abuseDetectionMiddleware', () => {
    test('debe crear middleware sin errores', () => {
      const middleware = abuseDetectionMiddleware();
      expect(typeof middleware).toBe('function');
    });
  });
});
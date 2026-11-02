/**
 * backend/src/tests/serviceHealth.test.js
 * Tests unitarios para serviceHealth.js
 */

// Mock the db module BEFORE requiring serviceHealth
jest.mock('../config/db', () => ({
  pool: {
    query: jest.fn(),
  },
}));

// Mock redis
jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    ping: jest.fn().mockResolvedValue('PONG'),
    quit: jest.fn().mockResolvedValue(undefined),
  })),
}));

const { 
  checkServiceHealth, 
  isServiceAvailable, 
  logServiceStatus,
  checkApiKeysOnly 
} = require('../config/serviceHealth');
const { pool } = require('../config/db');

describe('serviceHealth', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset env vars
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('checkServiceHealth', () => {
    test('todas las keys presentes → todos available', async () => {
      process.env.DEEPSEEK_API_KEY = 'test-key';
      process.env.GEMINI_API_KEY = 'test-key';
      process.env.NVIDIA_API_KEY = 'test-key';
      // Fixture de test: URL ficticia (sin credenciales reales). La sanitización de
      // A360-2026-09-22/C-02 había dejado esta línea como autoasignación y los casos
      // "URL presente pero conexión caída" caían en MISSING_URL.
      process.env.DATABASE_URL = 'postgresql://test_user:test_password_placeholder@127.0.0.1:5432/test_db';
      process.env.REDIS_URL = 'redis://localhost:6379';

      pool.query.mockResolvedValue({ rows: [{ '?column?': 1 }] });

      const health = await checkServiceHealth();

      expect(health.deepseek.available).toBe(true);
      expect(health.deepseek.reason).toBe('OK');
      expect(health.gemini.available).toBe(true);
      expect(health.nvidia.available).toBe(true);
      expect(health.database.available).toBe(true);
      expect(health.redis.available).toBe(true);
    });

    test('falta DEEPSEEK_API_KEY → deepseek unavailable, resto OK', async () => {
      delete process.env.DEEPSEEK_API_KEY;
      process.env.GEMINI_API_KEY = 'test-key';
      process.env.NVIDIA_API_KEY = 'test-key';
      // Fixture de test: URL ficticia (sin credenciales reales). La sanitización de
      // A360-2026-09-22/C-02 había dejado esta línea como autoasignación y los casos
      // "URL presente pero conexión caída" caían en MISSING_URL.
      process.env.DATABASE_URL = 'postgresql://test_user:test_password_placeholder@127.0.0.1:5432/test_db';

      pool.query.mockResolvedValue({ rows: [{ '?column?': 1 }] });

      const health = await checkServiceHealth();

      expect(health.deepseek.available).toBe(false);
      expect(health.deepseek.reason).toBe('MISSING_API_KEY');
      expect(health.gemini.available).toBe(true);
      expect(health.nvidia.available).toBe(true);
      expect(health.database.available).toBe(true);
    });

    test('falta DATABASE_URL → database unavailable, no crashea', async () => {
      process.env.DEEPSEEK_API_KEY = 'test-key';
      process.env.GEMINI_API_KEY = 'test-key';
      process.env.NVIDIA_API_KEY = 'test-key';
      delete process.env.DATABASE_URL;

      const health = await checkServiceHealth();

      expect(health.database.available).toBe(false);
      expect(health.database.reason).toBe('MISSING_URL');
      // Los demás deben estar OK
      expect(health.deepseek.available).toBe(true);
      expect(health.gemini.available).toBe(true);
      expect(health.nvidia.available).toBe(true);
    });

    test('DB connection failed → database unavailable con razón', async () => {
      process.env.DEEPSEEK_API_KEY = 'test-key';
      process.env.GEMINI_API_KEY = 'test-key';
      process.env.NVIDIA_API_KEY = 'test-key';
      // Fixture de test: URL ficticia (sin credenciales reales). La sanitización de
      // A360-2026-09-22/C-02 había dejado esta línea como autoasignación y los casos
      // "URL presente pero conexión caída" caían en MISSING_URL.
      process.env.DATABASE_URL = 'postgresql://test_user:test_password_placeholder@127.0.0.1:5432/test_db';

      pool.query.mockRejectedValue(new Error('Connection refused'));

      const health = await checkServiceHealth();

      expect(health.database.available).toBe(false);
      expect(health.database.reason).toContain('CONNECTION_FAILED');
    });
  });

  describe('isServiceAvailable', () => {
    test('debe retornar true si servicio disponible', async () => {
      process.env.DEEPSEEK_API_KEY = 'test-key';
      
      const available = await isServiceAvailable('deepseek');
      expect(available).toBe(true);
    });

    test('debe retornar false si servicio no disponible', async () => {
      delete process.env.DEEPSEEK_API_KEY;
      
      const available = await isServiceAvailable('deepseek');
      expect(available).toBe(false);
    });
  });

  describe('checkApiKeysOnly', () => {
    test('debe verificar solo presencia de keys sin conexión', () => {
      process.env.DEEPSEEK_API_KEY = 'key1';
      process.env.GEMINI_API_KEY = 'key2';
      delete process.env.NVIDIA_API_KEY;
      process.env.DATABASE_URL = 'url';
      delete process.env.REDIS_URL;

      const result = checkApiKeysOnly();

      expect(result.deepseek).toBe(true);
      expect(result.gemini).toBe(true);
      expect(result.nvidia).toBe(false);
      expect(result.database).toBe(true);
      expect(result.redis).toBe(false);
    });
  });

  describe('logServiceStatus', () => {
    test('debe ejecutarse sin errores', async () => {
      process.env.DEEPSEEK_API_KEY = 'test-key';
      process.env.GEMINI_API_KEY = 'test-key';
      process.env.NVIDIA_API_KEY = 'test-key';
      // Fixture de test: URL ficticia (sin credenciales reales). La sanitización de
      // A360-2026-09-22/C-02 había dejado esta línea como autoasignación y los casos
      // "URL presente pero conexión caída" caían en MISSING_URL.
      process.env.DATABASE_URL = 'postgresql://test_user:test_password_placeholder@127.0.0.1:5432/test_db';

      pool.query.mockResolvedValue({ rows: [{ '?column?': 1 }] });

      // No debe lanzar error
      await expect(logServiceStatus()).resolves.toBeDefined();
    });
  });
});
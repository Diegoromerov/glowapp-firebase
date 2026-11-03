// backend/src/tests/memoryFallbackProductionGuard.test.js
const { getDbStatus } = require('../config/db');

describe('FASE 3 — Prohibición del modo memoria en producción', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalFallback = process.env.ALLOW_MEMORY_FALLBACK;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    process.env.ALLOW_MEMORY_FALLBACK = originalFallback;
  });

  test('memoryFallbackAllowed devuelve false en producción independientemente de ALLOW_MEMORY_FALLBACK', () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_MEMORY_FALLBACK = 'true';

    const status = getDbStatus();
    expect(status.memoryFallbackAllowed).toBe(false);
  });

  test('memoryFallbackAllowed devuelve true en test/desarrollo cuando opt-in está activo', () => {
    process.env.NODE_ENV = 'test';
    process.env.ALLOW_MEMORY_FALLBACK = 'true';

    const status = getDbStatus();
    expect(status.memoryFallbackAllowed).toBe(true);
  });
});

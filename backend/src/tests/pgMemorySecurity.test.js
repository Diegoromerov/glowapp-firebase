// backend/src/tests/pgMemorySecurity.test.js

describe('pgMemory Security Rules', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('isMemoryMode returns false when NODE_ENV === "production"', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.RAILWAY_ENVIRONMENT;
    process.env.USE_PG_MEM = 'true';

    const pgMemory = require('../config/pgMemory');
    expect(pgMemory.isMemoryMode).toBe(false);
  });

  test('isMemoryMode returns false when RAILWAY_ENVIRONMENT is set', () => {
    process.env.NODE_ENV = 'test';
    process.env.RAILWAY_ENVIRONMENT = 'production';
    process.env.USE_PG_MEM = 'true';

    const pgMemory = require('../config/pgMemory');
    expect(pgMemory.isMemoryMode).toBe(false);
  });

  test('isMemoryMode returns true in test env when USE_PG_MEM is true and not in prod', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.RAILWAY_ENVIRONMENT;
    process.env.USE_PG_MEM = 'true';

    const pgMemory = require('../config/pgMemory');
    expect(pgMemory.isMemoryMode).toBe(true);
  });
});

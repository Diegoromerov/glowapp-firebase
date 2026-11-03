const test = require('node:test');
const assert = require('node:assert/strict');

test('D-01 DB Memory Security Guard — strictly fails closed in production and staging', async (t) => {
  const originalEnv = { ...process.env };

  t.afterEach(() => {
    process.env = { ...originalEnv };
  });

  await t.test('memoryFallbackAllowed returns false in production', () => {
    delete require.cache[require.resolve('../config/db')];
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_MEMORY_FALLBACK;

    const db = require('../config/db');
    assert.strictEqual(db.memoryFallbackAllowed(), false);
  });

  await t.test('memoryFallbackAllowed returns false in staging', () => {
    delete require.cache[require.resolve('../config/db')];
    process.env.NODE_ENV = 'staging';

    const db = require('../config/db');
    assert.strictEqual(db.memoryFallbackAllowed(), false);
  });

  await t.test('memoryFallbackAllowed returns false when RAILWAY_ENVIRONMENT is set', () => {
    delete require.cache[require.resolve('../config/db')];
    process.env.NODE_ENV = 'development';
    process.env.RAILWAY_ENVIRONMENT = 'production';

    const db = require('../config/db');
    assert.strictEqual(db.memoryFallbackAllowed(), false);
  });

  await t.test('testConnection throws critical error in production when DB is down', async () => {
    delete require.cache[require.resolve('../config/db')];
    process.env.NODE_ENV = 'production';
    process.env.DB_HOST = '127.0.0.1';
    process.env.DB_PORT = '59999'; // Non-existent port
    delete process.env.DATABASE_URL;

    const db = require('../config/db');
    await assert.rejects(
      async () => {
        await db.testConnection();
      },
      (err) => {
        assert.ok(err);
        return true;
      }
    );
  });

  await t.test('pool.query throws immediately when DB connection fails in production', async () => {
    delete require.cache[require.resolve('../config/db')];
    process.env.NODE_ENV = 'production';
    process.env.DB_HOST = '127.0.0.1';
    process.env.DB_PORT = '59999';
    delete process.env.DATABASE_URL;

    const db = require('../config/db');
    await assert.rejects(
      async () => {
        await db.pool.query('SELECT 1');
      },
      (err) => {
        assert.ok(err);
        assert.strictEqual(db.getDbStatus().dbMode, 'indefinido');
        assert.strictEqual(db.getDbStatus().servingFabricatedData, false);
        return true;
      }
    );
  });
});

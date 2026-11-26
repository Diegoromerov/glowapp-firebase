const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const { getLimit, getMonthPeriod } = require('../src/config/saasCatalog');

const ADMIN_URL = process.env.DATABASE_URL_ADMIN;
const APP_URL = process.env.DATABASE_URL;
const describeWithPostgres = ADMIN_URL && APP_URL ? describe : describe.skip;

describeWithPostgres('SaaS external API with PostgreSQL RLS', () => {
  let adminPool;
  let app;
  let routerPool;
  let verticalId;
  let ownerId;
  let otherOwnerId;
  let profileId;
  let otherProfileId;
  let apiKeyId;
  let rawKey;
  let ownServiceId;
  const period = getMonthPeriod();

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    routerPool = require('../src/config/db').pool;
    app = express();
    app.use('/api/integrations/v1', require('../src/routes/saasExternalApiRoutes'));
    verticalId = crypto.randomUUID();
    profileId = crypto.randomUUID();
    otherProfileId = crypto.randomUUID();
    const ownerEmail = `external-api-${crypto.randomUUID()}@test.local`;
    const otherEmail = `external-api-other-${crypto.randomUUID()}@test.local`;

    await adminPool.query(
      'INSERT INTO business_verticals (id, code, name, description) VALUES ($1, $2, $3, $4)',
      [verticalId, `EA_${verticalId}`, 'External API test', 'Temporary integration fixture']
    );
    const owners = await Promise.all([
      adminPool.query(
        `INSERT INTO usuarios (email, password_hash, nombre, auth_provider, provider_id, rol, tenant_id)
         VALUES ($1, $2, $3, 'LOCAL', $1, 'SALON', 1) RETURNING id`,
        [ownerEmail, 'integration-test-only', 'External API owner']
      ),
      adminPool.query(
        `INSERT INTO usuarios (email, password_hash, nombre, auth_provider, provider_id, rol, tenant_id)
         VALUES ($1, $2, $3, 'LOCAL', $1, 'SALON', 1) RETURNING id`,
        [otherEmail, 'integration-test-only', 'External API other owner']
      ),
    ]);
    ownerId = owners[0].rows[0].id;
    otherOwnerId = owners[1].rows[0].id;
    await adminPool.query(
      `INSERT INTO business_profiles (id, provider_id, vertical_id, name, tenant_id, saas_plan)
       VALUES ($1, $2, $3, $4, $1, 'PRO'), ($5, $6, $3, $7, $5, 'PRO')`,
      [profileId, ownerId, verticalId, 'External API owner salon', otherProfileId, otherOwnerId, 'External API other salon']
    );

    rawKey = `gsk_live_${crypto.randomBytes(24).toString('base64url')}`;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const insertedKey = await adminPool.query(
      `INSERT INTO api_keys (tenant_id, name, key_hash, key_prefix, scopes, expires_at)
       VALUES ($1, 'External API integration test', $2, $3, ARRAY['read'], NOW() + INTERVAL '1 day')
       RETURNING id`,
      [profileId, keyHash, rawKey.slice(0, 12)]
    );
    apiKeyId = insertedKey.rows[0].id;

    const ownService = await adminPool.query(
      `INSERT INTO services (provider_id, tenant_id, business_profile_id, name, price, duration_minutes, is_active)
       VALUES ($1, 1, $2, 'Own service', 25000, 45, TRUE) RETURNING id`,
      [ownerId, profileId]
    );
    ownServiceId = ownService.rows[0].id;
    await adminPool.query(
      `INSERT INTO services (provider_id, tenant_id, business_profile_id, name, price, duration_minutes, is_active)
       VALUES ($1, 1, $2, 'Other tenant private service', 99000, 90, TRUE)`,
      [otherOwnerId, otherProfileId]
    );
  });

  afterAll(async () => {
    if (adminPool) {
      if (profileId) {
        await adminPool.query('DELETE FROM services WHERE business_profile_id IN ($1, $2)', [profileId, otherProfileId]);
        await adminPool.query('DELETE FROM api_keys WHERE tenant_id = $1', [profileId]);
        await adminPool.query("DELETE FROM usage_metrics WHERE tenant_id = $1 AND feature = 'API_CALLS'", [profileId]);
        await adminPool.query('DELETE FROM business_profiles WHERE id IN ($1, $2)', [profileId, otherProfileId]);
      }
      if (ownerId) await adminPool.query('DELETE FROM usuarios WHERE id IN ($1, $2)', [ownerId, otherOwnerId]);
      if (verticalId) await adminPool.query('DELETE FROM business_verticals WHERE id = $1', [verticalId]);
      await adminPool.end();
      await routerPool.end();
    }
  });

  test('authenticates the key, isolates tenant services, and atomically rejects the concurrent request over quota', async () => {
    const limit = getLimit('PRO', 'API_CALLS');
    expect(limit).toBeGreaterThan(0);
    await adminPool.query(
      `INSERT INTO usage_metrics (tenant_id, feature, period_start, period_end, count, "limit")
       VALUES ($1, 'API_CALLS', $2, $3, $4, $5)`,
      [profileId, period.start, period.end, limit - 1, limit]
    );

    const call = () => request(app).get('/api/integrations/v1/services?limit=10')
      .set('Authorization', `Bearer ${rawKey}`);
    const responses = await Promise.all([call(), call()]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 429]);
    const success = responses.find((response) => response.status === 200);
    expect(success.body.data.map((service) => service.id)).toContain(ownServiceId);
    expect(success.body.data.some((service) => service.name === 'Other tenant private service')).toBe(false);

    const persisted = await adminPool.query(
      `SELECT count FROM usage_metrics
        WHERE tenant_id = $1 AND feature = 'API_CALLS' AND period_start = $2`,
      [profileId, period.start]
    );
    expect(Number(persisted.rows[0].count)).toBe(limit);
    const usedKey = await adminPool.query('SELECT last_used_at FROM api_keys WHERE id = $1', [apiKeyId]);
    expect(usedKey.rows[0].last_used_at).not.toBeNull();
  }, 30000);

  test('rejects missing, revoked, and insufficient-scope API keys without usage', async () => {
    const missing = await request(app).get('/api/integrations/v1/services');
    expect(missing.status).toBe(401);
    const noScopeKey = `gsk_live_${crypto.randomBytes(24).toString('base64url')}`;
    await adminPool.query(
      `INSERT INTO api_keys (tenant_id, name, key_hash, key_prefix, scopes, expires_at)
       VALUES ($1, 'No read scope test', $2, $3, ARRAY['write'], NOW() + INTERVAL '1 day')`,
      [profileId, crypto.createHash('sha256').update(noScopeKey).digest('hex'), noScopeKey.slice(0, 12)]
    );
    const noScope = await request(app).get('/api/integrations/v1/services')
      .set('Authorization', `Bearer ${noScopeKey}`);
    expect(noScope.status).toBe(403);

    await adminPool.query('UPDATE api_keys SET revoked_at = NOW() WHERE id = $1', [apiKeyId]);
    const revoked = await request(app).get('/api/integrations/v1/services')
      .set('Authorization', `Bearer ${rawKey}`);
    expect(revoked.status).toBe(401);
    await adminPool.query('DELETE FROM api_keys WHERE tenant_id = $1 AND name = $2', [profileId, 'No read scope test']);
  }, 30000);
});

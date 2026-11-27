const crypto = require('crypto');
const { Pool } = require('pg');
const { consumeAuraBusinessQuery } = require('../src/services/usageMeteringService');
const { getLimit, getMonthPeriod } = require('../src/config/saasCatalog');

const ADMIN_URL = process.env.DATABASE_URL_ADMIN;
const APP_URL = process.env.DATABASE_URL;
const describeWithPostgres = ADMIN_URL && APP_URL ? describe : describe.skip;

describeWithPostgres('Aura business quota with PostgreSQL RLS', () => {
  let adminPool;
  let appPool;
  let verticalId;
  let userId;
  let profileId;
  const period = getMonthPeriod();

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    appPool = new Pool({ connectionString: APP_URL });
    verticalId = crypto.randomUUID();
    profileId = crypto.randomUUID();
    const email = `aura-quota-${crypto.randomUUID()}@test.local`;

    await adminPool.query(
      'INSERT INTO business_verticals (id, code, name, description) VALUES ($1, $2, $3, $4)',
      [verticalId, `AQ_${verticalId}`, 'Aura quota test', 'Temporary integration fixture']
    );
    const user = await adminPool.query(
      `INSERT INTO usuarios (email, password_hash, nombre, auth_provider, provider_id, rol, tenant_id)
       VALUES ($1, $2, $3, 'LOCAL', $1, 'SALON', 1) RETURNING id`,
      [email, 'integration-test-only', 'Aura quota owner']
    );
    userId = user.rows[0].id;
    await adminPool.query(
      `INSERT INTO business_profiles (id, provider_id, vertical_id, name, tenant_id, saas_plan)
       VALUES ($1, $2, $3, 'Aura quota test salon', $1, 'FREE_TRIAL_LEGACY')`,
      [profileId, userId, verticalId]
    );
    const membershipClient = await adminPool.connect();
    try {
      await membershipClient.query('BEGIN');
      await membershipClient.query("SELECT set_config('app.user_id', $1, true)", [String(userId)]);
      await membershipClient.query("SELECT set_config('app.business_profile_id', $1, true)", [profileId]);
      await membershipClient.query(
        `INSERT INTO memberships (id, user_id, business_profile_id, role, status, accepted_at, created_by_user_id)
         VALUES ($1, $2, $3, 'OWNER', 'ACTIVE', NOW(), $2)`,
        [crypto.randomUUID(), userId, profileId]
      );
      await membershipClient.query('COMMIT');
    } catch (error) {
      await membershipClient.query('ROLLBACK');
      throw error;
    } finally {
      membershipClient.release();
    }
  });

  afterAll(async () => {
    if (adminPool) {
      if (profileId) {
        await adminPool.query(
          `DELETE FROM usage_metrics WHERE tenant_id = $1 AND feature = 'AURA_QUERIES'`,
          [profileId]
        );
        await adminPool.query('DELETE FROM memberships WHERE business_profile_id = $1', [profileId]);
        await adminPool.query('DELETE FROM business_profiles WHERE id = $1', [profileId]);
      }
      if (userId) await adminPool.query('DELETE FROM usuarios WHERE id = $1', [userId]);
      if (verticalId) await adminPool.query('DELETE FROM business_verticals WHERE id = $1', [verticalId]);
      await appPool.end();
      await adminPool.end();
    }
  });

  test('validates the active member and atomically rejects the request over the monthly quota', async () => {
    const limit = getLimit('FREE_TRIAL_LEGACY', 'AURA_QUERIES');
    await adminPool.query(
      `INSERT INTO usage_metrics (tenant_id, feature, period_start, period_end, count, "limit")
       VALUES ($1, 'AURA_QUERIES', $2, $3, $4, $5)`,
      [profileId, period.start, period.end, limit - 1, limit]
    );

    const results = await Promise.all([
      consumeAuraBusinessQuery({ tenantId: profileId, userId, dbPool: appPool }),
      consumeAuraBusinessQuery({ tenantId: profileId, userId, dbPool: appPool }),
    ]);
    expect(results.map((result) => result.allowed).sort()).toEqual([false, true]);
    expect(results.find((result) => !result.allowed)).toMatchObject({
      reason: 'Quota exceeded', limit, current: limit, remaining: 0,
    });

    const persisted = await adminPool.query(
      `SELECT count FROM usage_metrics
        WHERE tenant_id = $1 AND feature = 'AURA_QUERIES' AND period_start = $2`,
      [profileId, period.start]
    );
    expect(Number(persisted.rows[0].count)).toBe(limit);
  }, 30000);

  test('denies a plan without AURA_BUSINESS before writing usage', async () => {
    await adminPool.query("UPDATE business_profiles SET saas_plan = 'FREEMIUM' WHERE id = $1", [profileId]);

    const result = await consumeAuraBusinessQuery({ tenantId: profileId, userId, dbPool: appPool });

    expect(result).toMatchObject({ allowed: false, reason: 'Feature not included in plan', plan: 'FREEMIUM' });
    const persisted = await adminPool.query(
      `SELECT count FROM usage_metrics
        WHERE tenant_id = $1 AND feature = 'AURA_QUERIES' AND period_start = $2`,
      [profileId, period.start]
    );
    expect(Number(persisted.rows[0].count)).toBe(getLimit('FREE_TRIAL_LEGACY', 'AURA_QUERIES'));
  }, 30000);
});

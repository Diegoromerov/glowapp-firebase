// Exercise direct-booking quota serialization with the restricted app role and real PostgreSQL RLS.
const crypto = require('crypto');
const { Pool } = require('pg');
const { reserveDirectBookingQuota } = require('../src/services/saasDirectBookingQuota');
const { getLimit, getMonthPeriod } = require('../src/config/saasCatalog');

const ADMIN_URL = process.env.DATABASE_URL_ADMIN;
const APP_URL = process.env.DATABASE_URL;
const describeWithPostgres = ADMIN_URL && APP_URL ? describe : describe.skip;

describeWithPostgres('SaaS direct booking quota with PostgreSQL RLS', () => {
  let adminPool;
  let appPool;
  let verticalId;
  let userId;
  let profileId;
  let email;
  const period = getMonthPeriod();

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    appPool = new Pool({ connectionString: APP_URL });
    verticalId = crypto.randomUUID();
    profileId = crypto.randomUUID();
    email = `booking-quota-${crypto.randomUUID()}@test.local`;
    await adminPool.query(
      'INSERT INTO business_verticals (id, code, name, description) VALUES ($1, $2, $3, $4)',
      [verticalId, `BQ_${verticalId}`, 'Booking quota test', 'Ephemeral CI fixture']
    );
    const user = await adminPool.query(
      `INSERT INTO usuarios (email, password_hash, nombre, auth_provider, provider_id, rol, tenant_id)
       VALUES ($1, $2, $3, 'LOCAL', $1, 'SALON', 1) RETURNING id`,
      [email, 'integration-test-only', 'Booking quota test']
    );
    userId = user.rows[0].id;
    await adminPool.query(
      `INSERT INTO business_profiles (id, provider_id, vertical_id, name, tenant_id, saas_plan)
       VALUES ($1, $2, $3, $4, $5, 'FREEMIUM')`,
      [profileId, userId, verticalId, 'Booking quota test ' + profileId, profileId]
    );
  });

  afterAll(async () => {
    if (adminPool) {
      if (profileId) {
        await adminPool.query(
          `DELETE FROM usage_metrics WHERE tenant_id = $1 AND feature = 'DIRECT_BOOKINGS'`,
          [profileId]
        );
        await adminPool.query('DELETE FROM business_profiles WHERE id = $1', [profileId]);
      }
      if (userId) await adminPool.query('DELETE FROM usuarios WHERE id = $1', [userId]);
      if (verticalId) await adminPool.query('DELETE FROM business_verticals WHERE id = $1', [verticalId]);
      await appPool.end();
      await adminPool.end();
    }
  });

  test('RLS-visible profile and concurrent requests cannot exceed the final Freemium booking slot', async () => {
    const contextFor = async (client) => {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.user_id', $1, true)", [String(userId)]);
      // Legacy auth tenant differs from the canonical business profile tenant;
      // owner-scoped profile read policy must still expose this owner's plan.
      await client.query("SELECT set_config('app.tenant_id', $1, true)", ['1']);
    };
    const visibilityClient = await appPool.connect();
    try {
      await contextFor(visibilityClient);
      const visible = await visibilityClient.query(
        'SELECT saas_plan FROM business_profiles WHERE id = $1', [profileId]
      );
      expect(visible.rows).toEqual([{ saas_plan: 'FREEMIUM' }]);
      await visibilityClient.query('ROLLBACK');
    } finally {
      visibilityClient.release();
    }

    let historicalReads = 0;
    const attempt = async () => {
      const client = await appPool.connect();
      try {
        await contextFor(client);
        const result = await reserveDirectBookingQuota({
          query: (sql, params) => client.query(sql, params),
          tenantId: profileId,
          delta: 1,
          periodStart: period.start,
          periodEnd: period.end,
          getLimit,
          countHistorical: async () => {
            historicalReads += 1;
            return 29;
          },
        });
        await client.query('COMMIT');
        return { allowed: true, result };
      } catch (error) {
        await client.query('ROLLBACK');
        return { allowed: false, code: error.code, current: error.current };
      } finally {
        client.release();
      }
    };

    const outcomes = await Promise.all([attempt(), attempt()]);
    expect(outcomes.filter((item) => item.allowed)).toHaveLength(1);
    expect(outcomes.filter((item) => item.code === 'SAAS_QUOTA_EXCEEDED')).toEqual([
      expect.objectContaining({ allowed: false, current: 30 }),
    ]);
    expect(historicalReads).toBe(1);
    const persisted = await adminPool.query(
      `SELECT count FROM usage_metrics
        WHERE tenant_id = $1 AND feature = 'DIRECT_BOOKINGS' AND period_start = $2`,
      [profileId, period.start]
    );
    expect(Number(persisted.rows[0]?.count)).toBe(30);
  }, 30000);
});

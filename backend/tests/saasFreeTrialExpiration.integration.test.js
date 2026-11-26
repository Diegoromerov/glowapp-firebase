// Verify the scheduled trial lifecycle against an isolated PostgreSQL fixture.
// CI provides admin and app URLs; this suite never targets production.
const crypto = require('crypto');
const { Pool } = require('pg');
const { expireCompletedFreeTrials } = require('../src/jobs/saasFreeTrialExpirationCron');

const ADMIN_URL = process.env.DATABASE_URL_ADMIN;
const APP_URL = process.env.DATABASE_URL;
const describeWithPostgres = ADMIN_URL && APP_URL ? describe : describe.skip;

describeWithPostgres('SaaS free trial expiration on PostgreSQL', () => {
  let adminPool;
  let appPool;
  let verticalId;
  let userId;
  const profiles = [];

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    appPool = new Pool({ connectionString: APP_URL });
    verticalId = crypto.randomUUID();
    await adminPool.query(
      'INSERT INTO business_verticals (id, code, name, description) VALUES ($1, $2, $3, $4)',
      [verticalId, 'TEXP_' + verticalId, 'Trial expiry test', 'Ephemeral CI fixture']
    );
    const user = await adminPool.query(
      "INSERT INTO usuarios (email, password_hash, nombre, auth_provider, provider_id) VALUES ($1, $2, $3, 'LOCAL', $1) RETURNING id",
      ['trial-expiry-' + crypto.randomUUID() + '@test.local', 'integration-test-only', 'Trial expiry test']
    );
    userId = user.rows[0].id;
  });

  afterAll(async () => {
    if (adminPool) {
      if (profiles.length) {
        await adminPool.query("DELETE FROM audit_logs WHERE action = 'saas_free_trial_expired' AND target_id = ANY($1::text[])", [profiles]);
        await adminPool.query('DELETE FROM subscriptions WHERE tenant_id = ANY($1::text[])', [profiles]);
        await adminPool.query('DELETE FROM salones WHERE business_profile_id = ANY($1::text[])', [profiles]);
        await adminPool.query('DELETE FROM business_profiles WHERE id = ANY($1::text[])', [profiles]);
      }
      if (userId) await adminPool.query('DELETE FROM usuarios WHERE id = $1', [userId]);
      if (verticalId) await adminPool.query('DELETE FROM business_verticals WHERE id = $1', [verticalId]);
      await adminPool.end();
      if (appPool) await appPool.end();
    }
  });

  async function createTenant({ plan, endsAt, salonPlan = plan, paid = false }) {
    const id = crypto.randomUUID();
    profiles.push(id);
    await adminPool.query(
      `INSERT INTO business_profiles
         (id, provider_id, vertical_id, name, tenant_id, saas_plan, saas_trial_ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, userId, verticalId, 'Trial expiry ' + id, 'trial-test-' + id, plan, endsAt]
    );
    await adminPool.query(
      `INSERT INTO salones (id_dueno, nombre_salon, business_profile_id, plan_saas)
       VALUES ($1, $2, $3, $4)`,
      [userId, 'Trial expiry ' + id, id, salonPlan]
    );
    if (paid) {
      await adminPool.query(
        `INSERT INTO subscriptions
           (tenant_id, plan, status, current_period_start, current_period_end)
         VALUES ($1, 'BASIC', 'active', NOW(), NOW() + INTERVAL '1 month')`,
        [id]
      );
    }
    return id;
  }

  test('expires eligible trials, preserves paid and future tenants, and is idempotent', async () => {
    const expired = await createTenant({ plan: 'FREE_TRIAL', endsAt: new Date(Date.now() - 86400000) });
    const legacy = await createTenant({ plan: 'FREE_TRIAL_LEGACY', endsAt: new Date(Date.now() - 86400000) });
    const paid = await createTenant({ plan: 'FREE_TRIAL', endsAt: new Date(Date.now() - 86400000), paid: true });
    const future = await createTenant({ plan: 'FREE_TRIAL', endsAt: new Date(Date.now() + 86400000) });

    const result = await expireCompletedFreeTrials({ pool: appPool });
    expect(result).toEqual({ expired_tenants: 2, updated_salons: 2, audit_events: 2 });

    const states = await adminPool.query(
      'SELECT id, saas_plan FROM business_profiles WHERE id = ANY($1::text[])',
      [[expired, legacy, paid, future]]
    );
    const byId = new Map(states.rows.map((row) => [row.id, row.saas_plan]));
    expect(byId.get(expired)).toBe('FREEMIUM');
    expect(byId.get(legacy)).toBe('FREEMIUM');
    expect(byId.get(paid)).toBe('FREE_TRIAL');
    expect(byId.get(future)).toBe('FREE_TRIAL');

    const salonStates = await adminPool.query(
      'SELECT business_profile_id, plan_saas FROM salones WHERE business_profile_id = ANY($1::text[])',
      [[expired, legacy, paid, future]]
    );
    const salonByProfile = new Map(salonStates.rows.map((row) => [row.business_profile_id, row.plan_saas]));
    expect(salonByProfile.get(expired)).toBe('FREEMIUM');
    expect(salonByProfile.get(legacy)).toBe('FREEMIUM');
    expect(salonByProfile.get(paid)).toBe('FREE_TRIAL');
    expect(salonByProfile.get(future)).toBe('FREE_TRIAL');

    const secondRun = await expireCompletedFreeTrials({ pool: appPool });
    expect(secondRun).toEqual({ expired_tenants: 0, updated_salons: 0, audit_events: 0 });
    const audits = await adminPool.query(
      "SELECT COUNT(*)::int AS count FROM audit_logs WHERE action = 'saas_free_trial_expired' AND target_id = ANY($1::text[])",
      [[expired, legacy, paid, future]]
    );
    expect(audits.rows[0].count).toBe(2);
  }, 30000);
});

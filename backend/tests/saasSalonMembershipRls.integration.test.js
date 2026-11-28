'use strict';

// Proves that active SaaS memberships expose only their linked salon under
// the runtime RLS role, even when legacy tenant_id does not match the user.
const crypto = require('crypto');
const { Pool } = require('pg');

const ADMIN_URL = process.env.DATABASE_URL_ADMIN;
const APP_URL = process.env.DATABASE_URL;
const describeWithPostgres = ADMIN_URL && APP_URL ? describe : describe.skip;

describeWithPostgres('SaaS salon visibility under RLS', () => {
  let adminPool;
  let appPool;
  let verticalId;
  const fixtures = [];

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    appPool = new Pool({ connectionString: APP_URL });
    verticalId = crypto.randomUUID();
    await adminPool.query(
      'INSERT INTO business_verticals (id, code, name, description) VALUES ($1, $2, $3, $4)',
      [verticalId, `SALON_RLS_${verticalId}`, 'Salon RLS test', 'Ephemeral integration fixture'],
    );

    for (const label of ['alpha', 'beta']) {
      const suffix = crypto.randomUUID();
      const fixture = { profileId: crypto.randomUUID(), userId: null, salonId: null };
      fixtures.push(fixture);
      const email = `salon-rls-${label}-${suffix}@test.local`;
      const user = await adminPool.query(
        "INSERT INTO usuarios (email, password_hash, nombre, auth_provider, provider_id) VALUES ($1, $2, $3, 'LOCAL', $1) RETURNING id",
        [email, 'integration-test-only', `Salon RLS ${label}`],
      );
      fixture.userId = user.rows[0].id;
      await adminPool.query(
        'INSERT INTO business_profiles (id, provider_id, vertical_id, name, tenant_id) VALUES ($1, $2, $3, $4, $5)',
        [fixture.profileId, fixture.userId, verticalId, `Salon RLS ${label}`, `unmatched-${suffix}`],
      );
      const salon = await adminPool.query(
        'INSERT INTO salones (id_dueno, nombre_salon, business_profile_id) VALUES ($1, $2, $3) RETURNING id',
        [fixture.userId, `Salon RLS ${label}`, fixture.profileId],
      );
      fixture.salonId = salon.rows[0].id;
      await adminPool.query(
        "INSERT INTO memberships (id, user_id, business_profile_id, role, status, created_by_user_id) VALUES ($1, $2, $3, 'OWNER', 'ACTIVE', $2)",
        [crypto.randomUUID(), fixture.userId, fixture.profileId],
      );
    }
  });

  afterAll(async () => {
    if (!adminPool) return;
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      for (const fixture of fixtures) {
        if (!fixture.userId) continue;
        await client.query('ALTER TABLE membership_audit_logs DISABLE TRIGGER USER');
        await client.query('DELETE FROM membership_audit_logs WHERE business_profile_id = $1', [fixture.profileId]);
        await client.query('ALTER TABLE membership_audit_logs ENABLE TRIGGER USER');
        await client.query('ALTER TABLE memberships DISABLE TRIGGER trg_prevent_unsafe_membership_change');
        await client.query('DELETE FROM memberships WHERE business_profile_id = $1', [fixture.profileId]);
        await client.query('ALTER TABLE memberships ENABLE TRIGGER trg_prevent_unsafe_membership_change');
        await client.query('DELETE FROM salones WHERE business_profile_id = $1', [fixture.profileId]);
        await client.query('DELETE FROM business_profiles WHERE id = $1', [fixture.profileId]);
        await client.query('DELETE FROM usuarios WHERE id = $1', [fixture.userId]);
      }
      if (verticalId) await client.query('DELETE FROM business_verticals WHERE id = $1', [verticalId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
      await appPool?.end();
      await adminPool.end();
    }
  });

  test('active member reads their own linked salon and cannot read another tenant salon', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_rls_user');
      await client.query("SELECT set_config('app.user_id', $1, true)", [String(fixtures[0].userId)]);
      await client.query("SELECT set_config('app.tenant_id', '', true)");

      const ownSalon = await client.query(
        'SELECT id FROM salones WHERE id = $1 AND business_profile_id = $2',
        [fixtures[0].salonId, fixtures[0].profileId],
      );
      const otherSalon = await client.query(
        'SELECT id FROM salones WHERE id = $1 AND business_profile_id = $2',
        [fixtures[1].salonId, fixtures[1].profileId],
      );

      expect(ownSalon.rows.map((row) => row.id)).toEqual([fixtures[0].salonId]);
      expect(otherSalon.rows).toHaveLength(0);
      await client.query('ROLLBACK');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
});

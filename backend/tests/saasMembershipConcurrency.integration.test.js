// Integration coverage for SaaS seat serialization against real PostgreSQL.
// This suite is enabled only when CI provides both admin and app database URLs.
const crypto = require('crypto');
const { Pool } = require('pg');

jest.mock('../src/services/emailService', () => ({
  sendEmail: jest.fn().mockResolvedValue({ devMode: true }),
}));

const saasMembershipService = require('../src/services/saasMembershipService');

const ADMIN_URL = process.env.DATABASE_URL_ADMIN;
const APP_URL = process.env.DATABASE_URL;
const describeWithPostgres = ADMIN_URL && APP_URL ? describe : describe.skip;

describeWithPostgres('SaaS seat allocation concurrency on PostgreSQL', () => {
  let adminPool;
  let verticalId;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    const result = await adminPool.query(
      "SELECT id FROM business_verticals WHERE code = 'BELLEZA' ORDER BY id LIMIT 1"
    );
    if (!result.rows.length) {
      throw new Error('The BELLEZA business vertical must be seeded before this integration suite');
    }
    verticalId = result.rows[0].id;
  });

  afterAll(async () => {
    if (adminPool) await adminPool.end();
  });

  async function createFixture() {
    const client = await adminPool.connect();
    const fixture = {
      profileId: crypto.randomUUID(),
      userIds: [],
      memberships: {},
      emails: {},
    };
    try {
      await client.query('BEGIN');
      const createUser = async (label) => {
        const email = 'saas-seat-' + crypto.randomUUID() + '-' + label + '@test.local';
        const user = await client.query(
          'INSERT INTO usuarios (email, password_hash, nombre) VALUES ($1, $2, $3) RETURNING id',
          [email, 'integration-test-only', 'SaaS seat test ' + label]
        );
        fixture.userIds.push(user.rows[0].id);
        fixture.emails[label] = email;
        return user.rows[0].id;
      };

      fixture.ownerId = await createUser('owner');
      fixture.activeUserId = await createUser('active');
      fixture.suspendedUserId = await createUser('suspended');
      fixture.inviteeOneId = await createUser('invitee-one');
      fixture.inviteeTwoId = await createUser('invitee-two');

      await client.query(
        'INSERT INTO business_profiles (id, provider_id, vertical_id, name, tenant_id, saas_plan) VALUES ($1, $2, $3, $4, $5, $6)',
        [fixture.profileId, fixture.ownerId, verticalId, 'SaaS seat concurrency test', 'test-' + fixture.profileId, 'FREE_TRIAL']
      );
      await client.query("SELECT set_config('app.user_id', $1, true)", [String(fixture.ownerId)]);

      fixture.memberships.owner = crypto.randomUUID();
      fixture.memberships.active = crypto.randomUUID();
      fixture.memberships.suspended = crypto.randomUUID();
      await client.query(
        "INSERT INTO memberships (id, user_id, business_profile_id, role, status, created_by_user_id) VALUES ($1, $2, $3, 'OWNER', 'ACTIVE', $2)",
        [fixture.memberships.owner, fixture.ownerId, fixture.profileId]
      );
      await client.query(
        "INSERT INTO memberships (id, user_id, business_profile_id, role, status, created_by_user_id) VALUES ($1, $2, $3, 'MEMBER', 'ACTIVE', $4)",
        [fixture.memberships.active, fixture.activeUserId, fixture.profileId, fixture.ownerId]
      );
      await client.query(
        "INSERT INTO memberships (id, user_id, business_profile_id, role, status, created_by_user_id) VALUES ($1, $2, $3, 'MEMBER', 'SUSPENDED', $4)",
        [fixture.memberships.suspended, fixture.suspendedUserId, fixture.profileId, fixture.ownerId]
      );
      await client.query('COMMIT');
      return fixture;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function cleanupFixture(fixture) {
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM membership_audit_logs WHERE business_profile_id = $1', [fixture.profileId]);
      await client.query('ALTER TABLE memberships DISABLE TRIGGER trg_prevent_unsafe_membership_change');
      await client.query('DELETE FROM memberships WHERE business_profile_id = $1', [fixture.profileId]);
      await client.query('ALTER TABLE memberships ENABLE TRIGGER trg_prevent_unsafe_membership_change');
      await client.query('DELETE FROM business_profiles WHERE id = $1', [fixture.profileId]);
      await client.query('DELETE FROM usuarios WHERE id = ANY($1::integer[])', [fixture.userIds]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function assertExactlyOneSeatWinner(results, fixture) {
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ status: 403 });

    const usage = await adminPool.query(
      "SELECT COUNT(*)::int AS count FROM memberships WHERE business_profile_id = $1 AND status IN ('ACTIVE', 'PENDING', 'INVITED')",
      [fixture.profileId]
    );
    expect(usage.rows[0].count).toBe(3);
  }

  test('serializes two simultaneous invitations competing for the final trial seat', async () => {
    const fixture = await createFixture();
    try {
      const results = await Promise.allSettled([
        saasMembershipService.invite({
          tenantId: fixture.profileId,
          tenantName: 'SaaS seat concurrency test',
          plan: 'FREE_TRIAL',
          actorId: fixture.ownerId,
          email: fixture.emails['invitee-one'],
          role: 'MEMBER',
        }),
        saasMembershipService.invite({
          tenantId: fixture.profileId,
          tenantName: 'SaaS seat concurrency test',
          plan: 'FREE_TRIAL',
          actorId: fixture.ownerId,
          email: fixture.emails['invitee-two'],
          role: 'MEMBER',
        }),
      ]);

      await assertExactlyOneSeatWinner(results, fixture);
      const pending = await adminPool.query(
        "SELECT COUNT(*)::int AS count FROM memberships WHERE business_profile_id = $1 AND status = 'PENDING'",
        [fixture.profileId]
      );
      expect(pending.rows[0].count).toBe(1);
    } finally {
      await cleanupFixture(fixture);
    }
  }, 20000);

  test('serializes an invitation against reactivation for the same final trial seat', async () => {
    const fixture = await createFixture();
    try {
      const results = await Promise.allSettled([
        saasMembershipService.invite({
          tenantId: fixture.profileId,
          tenantName: 'SaaS seat concurrency test',
          plan: 'FREE_TRIAL',
          actorId: fixture.ownerId,
          email: fixture.emails['invitee-one'],
          role: 'MEMBER',
        }),
        saasMembershipService.setStatus({
          tenantId: fixture.profileId,
          memberId: fixture.memberships.suspended,
          actorId: fixture.ownerId,
          status: 'ACTIVE',
          plan: 'FREE_TRIAL',
        }),
      ]);

      await assertExactlyOneSeatWinner(results, fixture);
      const state = await adminPool.query(
        "SELECT status, COUNT(*)::int AS count FROM memberships WHERE business_profile_id = $1 AND user_id = $2 GROUP BY status",
        [fixture.profileId, fixture.suspendedUserId]
      );
      const suspended = state.rows.find((row) => row.status === 'SUSPENDED');
      const active = state.rows.find((row) => row.status === 'ACTIVE');
      expect(Boolean(active)).toBe(Boolean(!suspended));
    } finally {
      await cleanupFixture(fixture);
    }
  }, 20000);
});

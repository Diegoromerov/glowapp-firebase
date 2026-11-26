// Integration coverage for SaaS seat serialization against real PostgreSQL.
// This suite is enabled only when CI provides both admin and app database URLs.
const crypto = require('crypto');
const { Pool } = require('pg');

jest.mock('../src/services/emailService', () => ({
  sendEmail: jest.fn().mockResolvedValue({ devMode: true }),
}));

const saasMembershipService = require('../src/services/saasMembershipService');
const emailService = require('../src/services/emailService');

const ADMIN_URL = process.env.DATABASE_URL_ADMIN;
const APP_URL = process.env.DATABASE_URL;
const describeWithPostgres = ADMIN_URL && APP_URL ? describe : describe.skip;

describeWithPostgres('SaaS seat allocation concurrency on PostgreSQL', () => {
  let adminPool;
  let verticalId;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    verticalId = crypto.randomUUID();
    await adminPool.query(
      'INSERT INTO business_verticals (id, code, name, description) VALUES ($1, $2, $3, $4)',
      [verticalId, 'STEST_' + verticalId, 'SaaS seat test', 'Ephemeral test fixture']
    );
  });

  afterAll(async () => {
    if (adminPool) {
      if (verticalId) {
        await adminPool.query('DELETE FROM business_verticals WHERE id = $1', [verticalId]);
      }
      await adminPool.end();
    }
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
          "INSERT INTO usuarios (email, password_hash, nombre, auth_provider, provider_id) VALUES ($1, $2, $3, 'LOCAL', $1) RETURNING id",
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
        'INSERT INTO business_profiles (id, provider_id, vertical_id, name, tenant_id) VALUES ($1, $2, $3, $4, $5)',
        [fixture.profileId, fixture.ownerId, verticalId, 'SaaS seat concurrency test', 'test-' + fixture.profileId]
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
      await client.query('ALTER TABLE membership_audit_logs DISABLE TRIGGER USER');
      await client.query('DELETE FROM membership_audit_logs WHERE business_profile_id = $1', [fixture.profileId]);
      await client.query('ALTER TABLE membership_audit_logs ENABLE TRIGGER USER');
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
    if (fulfilled.length !== 1 || rejected.length !== 1) {
      const outcomes = results.map((result) => result.status === 'fulfilled'
        ? { status: result.status, value: result.value }
        : {
            status: result.status,
            error: result.reason?.message,
            httpStatus: result.reason?.status,
            code: result.reason?.code,
            detail: result.reason?.details,
          });
      throw new Error(`Expected one seat winner; outcomes: ${JSON.stringify(outcomes)}`);
    }
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
  test('rejects a mismatched email, then accepts the invitation only with the invited email', async () => {
    const fixture = await createFixture();
    const originalBrevoKey = process.env.BREVO_API_KEY;
    process.env.BREVO_API_KEY = 'mocked-integration-test-key';
    emailService.sendEmail.mockClear();
    try {
      const invitation = await saasMembershipService.invite({
        tenantId: fixture.profileId,
        tenantName: 'SaaS invitation PostgreSQL test',
        plan: 'FREE_TRIAL',
        actorId: fixture.ownerId,
        email: fixture.emails['invitee-one'],
        role: 'MEMBER',
      });
      expect(invitation.emailSent).toBe(false);
      expect(emailService.sendEmail).toHaveBeenCalledTimes(1);

      const latestEmail = emailService.sendEmail.mock.calls[emailService.sendEmail.mock.calls.length - 1][0];
      const tokenMatch = String(latestEmail.data.text).match(/token=([0-9a-f]{32})/i);
      expect(tokenMatch).not.toBeNull();
      const token = tokenMatch[1];

      await expect(saasMembershipService.accept({
        token,
        user: { id: fixture.inviteeOneId, email: 'different-account@test.local' },
      })).rejects.toMatchObject({ status: 403 });

      const stillPending = await adminPool.query(
        'SELECT status FROM memberships WHERE id = $1',
        [invitation.membershipId]
      );
      expect(stillPending.rows[0].status).toBe('PENDING');

      const accepted = await saasMembershipService.accept({
        token,
        user: { id: fixture.inviteeOneId, email: fixture.emails['invitee-one'] },
      });
      expect(accepted.status).toBe('ACTIVE');
      expect(accepted.accepted_at).toBeTruthy();

      const audit = await adminPool.query(
        'SELECT event_type FROM membership_audit_logs WHERE membership_id = $1',
        [invitation.membershipId]
      );
      expect(audit.rows.map((row) => row.event_type)).toEqual(
        expect.arrayContaining(['INVITED', 'INVITATION_ACCEPTED'])
      );
    } finally {
      if (originalBrevoKey === undefined) delete process.env.BREVO_API_KEY;
      else process.env.BREVO_API_KEY = originalBrevoKey;
      await cleanupFixture(fixture);
    }
  }, 20000);

  test('expires and safely resends a pending invitation when a seat is available', async () => {
    const fixture = await createFixture();
    const originalBrevoKey = process.env.BREVO_API_KEY;
    process.env.BREVO_API_KEY = 'mocked-integration-test-key';
    emailService.sendEmail.mockClear();
    const membershipId = crypto.randomUUID();
    const staleTokenHash = crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex');
    const seedClient = await adminPool.connect();
    try {
      await seedClient.query('BEGIN');
      await seedClient.query("SELECT set_config('app.user_id', $1, true)", [String(fixture.ownerId)]);
      await seedClient.query(
        "INSERT INTO memberships (id, user_id, business_profile_id, invite_email, role, status, invited_by, invited_at, invite_token_hash, invite_expires_at, created_by_user_id) VALUES ($1, $2, $3, $4, 'MEMBER', 'PENDING', $5, NOW() - INTERVAL '8 days', $6, NOW() - INTERVAL '1 day', $5)",
        [membershipId, fixture.inviteeOneId, fixture.profileId, fixture.emails['invitee-one'], fixture.ownerId, staleTokenHash]
      );
      await seedClient.query('COMMIT');

      const resent = await saasMembershipService.resend({
        tenantId: fixture.profileId,
        memberId: membershipId,
        actorId: fixture.ownerId,
        tenantName: 'SaaS invitation PostgreSQL test',
        plan: 'FREE_TRIAL',
      });
      expect(resent.emailSent).toBe(false);
      expect(emailService.sendEmail).toHaveBeenCalledTimes(1);

      const current = await adminPool.query(
        'SELECT status, invite_token_hash, invite_expires_at FROM memberships WHERE id = $1',
        [membershipId]
      );
      expect(current.rows[0].status).toBe('PENDING');
      expect(current.rows[0].invite_token_hash).toMatch(/^[0-9a-f]{64}$/i);
      expect(new Date(current.rows[0].invite_expires_at).getTime()).toBeGreaterThan(Date.now());

      const audit = await adminPool.query(
        'SELECT event_type FROM membership_audit_logs WHERE membership_id = $1',
        [membershipId]
      );
      expect(audit.rows.map((row) => row.event_type)).toEqual(
        expect.arrayContaining(['INVITATION_EXPIRED', 'INVITATION_RESENT'])
      );
    } finally {
      await seedClient.query('ROLLBACK').catch(() => {});
      seedClient.release();
      if (originalBrevoKey === undefined) delete process.env.BREVO_API_KEY;
      else process.env.BREVO_API_KEY = originalBrevoKey;
      await cleanupFixture(fixture);
    }
  }, 20000);
});

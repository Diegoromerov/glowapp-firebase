// Integration coverage for SaaS seat serialization against real PostgreSQL.
// This suite is enabled only when CI provides both admin and app database URLs.
const crypto = require('crypto');
const { Pool } = require('pg');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../src/config/jwt');
const saasTeamRoutes = require('../src/routes/saasTeamRoutes');

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
  let appPool;
  let verticalId;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    appPool = new Pool({ connectionString: APP_URL });
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
      if (appPool) await appPool.end();
    }
  });

  async function createFixture(activeRole = 'MEMBER') {
    const client = await adminPool.connect();
    const fixture = {
      profileId: crypto.randomUUID(),
      salonId: null,
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
      const salon = await client.query(
        'INSERT INTO salones (id_dueno, nombre_salon, business_profile_id) VALUES ($1, $2, $3) RETURNING id',
        [fixture.ownerId, 'SaaS seat concurrency test', fixture.profileId]
      );
      fixture.salonId = salon.rows[0].id;
      await client.query("SELECT set_config('app.user_id', $1, true)", [String(fixture.ownerId)]);

      fixture.memberships.owner = crypto.randomUUID();
      fixture.memberships.active = crypto.randomUUID();
      fixture.memberships.suspended = crypto.randomUUID();
      await client.query(
        "INSERT INTO memberships (id, user_id, business_profile_id, role, status, created_by_user_id) VALUES ($1, $2, $3, 'OWNER', 'ACTIVE', $2)",
        [fixture.memberships.owner, fixture.ownerId, fixture.profileId]
      );
      await client.query(
        "INSERT INTO memberships (id, user_id, business_profile_id, role, status, created_by_user_id) VALUES ($1, $2, $3, $4, 'ACTIVE', $5)",
        [fixture.memberships.active, fixture.activeUserId, fixture.profileId, activeRole, fixture.ownerId]
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
      await client.query('DELETE FROM salones WHERE business_profile_id = $1', [fixture.profileId]);
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
    emailService.sendEmail.mockResolvedValue({ devMode: true });
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

  test('does not activate a pending invitation after the tenant loses TEAM_MANAGEMENT', async () => {
    const fixture = await createFixture();
    const originalBrevoKey = process.env.BREVO_API_KEY;
    process.env.BREVO_API_KEY = 'mocked-integration-test-key';
    emailService.sendEmail.mockClear();
    emailService.sendEmail.mockResolvedValue({ devMode: true });
    try {
      const invitation = await saasMembershipService.invite({
        tenantId: fixture.profileId,
        tenantName: 'SaaS downgrade invitation test',
        plan: 'FREE_TRIAL',
        actorId: fixture.ownerId,
        email: fixture.emails['invitee-one'],
        role: 'MEMBER',
      });
      const latestEmail = emailService.sendEmail.mock.calls.at(-1)[0];
      const token = String(latestEmail.data.text).match(/token=([0-9a-f]{32})/i)?.[1];
      expect(token).toBeTruthy();

      await adminPool.query(
        "UPDATE business_profiles SET saas_plan = 'FREEMIUM' WHERE id = $1",
        [fixture.profileId]
      );

      await expect(saasMembershipService.accept({
        token,
        user: { id: fixture.inviteeOneId, email: fixture.emails['invitee-one'] },
      })).rejects.toMatchObject({
        status: 403,
        details: { code: 'TEAM_MANAGEMENT_NOT_INCLUDED', currentPlan: 'FREEMIUM' },
      });

      const unchanged = await adminPool.query(
        'SELECT status, invite_token_hash FROM memberships WHERE id = $1',
        [invitation.membershipId]
      );
      expect(unchanged.rows[0]).toMatchObject({ status: 'PENDING' });
      expect(unchanged.rows[0].invite_token_hash).toBeTruthy();
    } finally {
      if (originalBrevoKey === undefined) delete process.env.BREVO_API_KEY;
      else process.env.BREVO_API_KEY = originalBrevoKey;
      await cleanupFixture(fixture);
    }
  }, 20000);

  test('rechecks the seat limit if the plan shrinks while an invitation is pending', async () => {
    const fixture = await createFixture();
    const originalBrevoKey = process.env.BREVO_API_KEY;
    process.env.BREVO_API_KEY = 'mocked-integration-test-key';
    emailService.sendEmail.mockClear();
    emailService.sendEmail.mockResolvedValue({ devMode: true });
    try {
      await adminPool.query(
        "UPDATE business_profiles SET saas_plan = 'BASIC' WHERE id = $1",
        [fixture.profileId]
      );
      await saasMembershipService.setStatus({
        tenantId: fixture.profileId,
        memberId: fixture.memberships.suspended,
        actorId: fixture.ownerId,
        status: 'ACTIVE',
        plan: 'BASIC',
      });

      const inviteeTwo = await saasMembershipService.invite({
        tenantId: fixture.profileId, tenantName: 'Seat downgrade test', plan: 'BASIC',
        actorId: fixture.ownerId, email: fixture.emails['invitee-two'], role: 'MEMBER',
      });
      const tokenTwo = String(emailService.sendEmail.mock.calls.at(-1)[0].data.text)
        .match(/token=([0-9a-f]{32})/i)?.[1];
      await saasMembershipService.accept({
        token: tokenTwo,
        user: { id: fixture.inviteeTwoId, email: fixture.emails['invitee-two'] },
      });

      const inviteeOne = await saasMembershipService.invite({
        tenantId: fixture.profileId, tenantName: 'Seat downgrade test', plan: 'BASIC',
        actorId: fixture.ownerId, email: fixture.emails['invitee-one'], role: 'MEMBER',
      });
      const tokenOne = String(emailService.sendEmail.mock.calls.at(-1)[0].data.text)
        .match(/token=([0-9a-f]{32})/i)?.[1];
      expect(tokenOne).toBeTruthy();

      await adminPool.query(
        "UPDATE business_profiles SET saas_plan = 'FREE_TRIAL' WHERE id = $1",
        [fixture.profileId]
      );

      await expect(saasMembershipService.accept({
        token: tokenOne,
        user: { id: fixture.inviteeOneId, email: fixture.emails['invitee-one'] },
      })).rejects.toMatchObject({
        status: 403,
        details: { code: 'SAAS_QUOTA_EXCEEDED', feature: 'TEAM_SEATS', current: 4, limit: 3, plan: 'FREE_TRIAL' },
      });

      const unchanged = await adminPool.query(
        'SELECT status FROM memberships WHERE id = $1', [inviteeOne.membershipId]
      );
      expect(unchanged.rows[0].status).toBe('PENDING');
    } finally {
      if (originalBrevoKey === undefined) delete process.env.BREVO_API_KEY;
      else process.env.BREVO_API_KEY = originalBrevoKey;
      await cleanupFixture(fixture);
    }
  }, 30000);

  test('expires and safely resends a pending invitation when a seat is available', async () => {
    const fixture = await createFixture();
    const originalBrevoKey = process.env.BREVO_API_KEY;
    process.env.BREVO_API_KEY = 'mocked-integration-test-key';
    emailService.sendEmail.mockClear();
    emailService.sendEmail.mockResolvedValue({ devMode: true });
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

  test('RLS and membership service isolate team data between two salons', async () => {
    const salonA = await createFixture();
    const salonB = await createFixture();
    try {
      const invitation = await saasMembershipService.invite({
        tenantId: salonB.profileId,
        tenantName: 'Tenant isolation fixture B',
        plan: 'FREE_TRIAL',
        actorId: salonB.ownerId,
        email: salonB.emails['invitee-one'],
        role: 'MEMBER',
      });
      expect(invitation.membershipId).toBeTruthy();

      const client = await appPool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.user_id', $1, true)", [String(salonB.ownerId)]);
        await client.query("SELECT set_config('app.business_profile_id', $1, true)", [salonB.profileId]);
        const ownMemberships = await client.query(
          'SELECT id FROM memberships WHERE business_profile_id = $1',
          [salonB.profileId]
        );
        expect(ownMemberships.rows.length).toBeGreaterThanOrEqual(3);
        const ownAudit = await client.query(
          'SELECT id FROM membership_audit_logs WHERE business_profile_id = $1',
          [salonB.profileId]
        );
        expect(ownAudit.rows.length).toBeGreaterThan(0);

        await client.query("SELECT set_config('app.user_id', $1, true)", [String(salonA.ownerId)]);
        await client.query("SELECT set_config('app.business_profile_id', $1, true)", [salonA.profileId]);
        const foreignMemberships = await client.query(
          'SELECT id FROM memberships WHERE business_profile_id = $1',
          [salonB.profileId]
        );
        expect(foreignMemberships.rows).toHaveLength(0);
        const foreignAudit = await client.query(
          'SELECT id FROM membership_audit_logs WHERE business_profile_id = $1',
          [salonB.profileId]
        );
        expect(foreignAudit.rows).toHaveLength(0);
        const foreignUserInfo = await client.query(
          'SELECT user_id FROM app_saas_team_user_info($1)',
          [salonB.profileId]
        );
        expect(foreignUserInfo.rows).toHaveLength(0);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      const foreignTeamViaService = await saasMembershipService.list(salonB.profileId, salonA.ownerId);
      expect(foreignTeamViaService).toHaveLength(0);
    } finally {
      await cleanupFixture(salonA);
      await cleanupFixture(salonB);
    }
  }, 20000);


  test('authenticated HTTP team route binds each JWT to its own tenant despite a foreign tenant query', async () => {
    const salonA = await createFixture();
    const salonB = await createFixture();
    try {
      const app = express();
      app.use('/api/saas/team', saasTeamRoutes);
      app.use((error, _req, res, _next) => {
        console.error('SaaS team integration request failed:', error.message);
        res.status(500).json({ error: 'Internal test request failure' });
      });

      const tokenA = jwt.sign(
        { id: salonA.ownerId, email: salonA.emails.owner },
        getJwtSecret(),
        { expiresIn: '5m' }
      );
      const tokenB = jwt.sign(
        { id: salonB.ownerId, email: salonB.emails.owner },
        getJwtSecret(),
        { expiresIn: '5m' }
      );

      const responseA = await request(app)
        .get('/api/saas/team')
        .query({ tenantId: salonB.profileId })
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(responseA.body.tenantId).toBe(salonA.profileId);
      const userIdsA = responseA.body.members.map((member) => Number(member.user_id));
      expect(userIdsA).toContain(Number(salonA.ownerId));
      expect(userIdsA.some((id) => salonB.userIds.includes(id))).toBe(false);

      const responseB = await request(app)
        .get('/api/saas/team')
        .query({ tenantId: salonA.profileId })
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);
      expect(responseB.body.tenantId).toBe(salonB.profileId);
      const userIdsB = responseB.body.members.map((member) => Number(member.user_id));
      expect(userIdsB).toContain(Number(salonB.ownerId));
      expect(userIdsB.some((id) => salonA.userIds.includes(id))).toBe(false);
    } finally {
      await cleanupFixture(salonA);
      await cleanupFixture(salonB);
    }
  }, 20000);


  test('authenticated HTTP team routes enforce OWNER, ADMIN and MEMBER permissions against PostgreSQL', async () => {
    const salonWithAdmin = await createFixture('ADMIN');
    const salonWithMember = await createFixture('MEMBER');
    try {
      const app = express();
      app.use(express.json());
      app.use('/api/saas/team', saasTeamRoutes);
      app.use((error, _req, res, _next) => {
        console.error('SaaS team RBAC integration request failed:', error.message);
        res.status(500).json({ error: 'Internal test request failure' });
      });

      const tokenFor = (fixture, label) => jwt.sign(
        { id: fixture[ label === 'owner' ? 'ownerId' : 'activeUserId' ], email: fixture.emails[label] },
        getJwtSecret(),
        { expiresIn: '5m' }
      );
      const ownerAdminToken = tokenFor(salonWithAdmin, 'owner');
      const adminToken = tokenFor(salonWithAdmin, 'active');
      const memberToken = tokenFor(salonWithMember, 'active');

      const adminInvite = await request(app)
        .post('/api/saas/team/invite')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: salonWithAdmin.emails['invitee-two'], role: 'MEMBER' })
        .expect(202);
      expect(adminInvite.body.membershipId).toBeTruthy();

      await request(app)
        .delete(`/api/saas/team/${adminInvite.body.membershipId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const reactivation = await request(app)
        .patch(`/api/saas/team/${salonWithAdmin.memberships.suspended}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'ACTIVE' })
        .expect(200);
      expect(reactivation.body.membership.status).toBe('ACTIVE');

      await request(app)
        .patch(`/api/saas/team/${salonWithAdmin.memberships.active}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'MANAGER' })
        .expect(403);

      const ownerRoleChange = await request(app)
        .patch(`/api/saas/team/${salonWithAdmin.memberships.active}/role`)
        .set('Authorization', `Bearer ${ownerAdminToken}`)
        .send({ role: 'MANAGER' })
        .expect(200);
      expect(ownerRoleChange.body.membership.role).toBe('MANAGER');

      await request(app)
        .post('/api/saas/team/invite')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ email: `member-invite-${crypto.randomUUID()}@test.local`, role: 'MEMBER' })
        .expect(403);

      await request(app)
        .patch(`/api/saas/team/${salonWithMember.memberships.suspended}/status`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ status: 'ACTIVE' })
        .expect(403);

      await request(app)
        .patch(`/api/saas/team/${salonWithMember.memberships.active}/role`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ role: 'MANAGER' })
        .expect(403);

      const deniedInvite = await adminPool.query(
        "SELECT COUNT(*)::int AS count FROM memberships WHERE business_profile_id = $1 AND invite_email LIKE 'member-invite-%@test.local'",
        [salonWithMember.profileId]
      );
      expect(deniedInvite.rows[0].count).toBe(0);
    } finally {
      await cleanupFixture(salonWithAdmin);
      await cleanupFixture(salonWithMember);
    }
  }, 20000);

});

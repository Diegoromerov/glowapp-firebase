jest.mock('../../config/db', () => ({
  pool: { connect: jest.fn() },
}));
jest.mock('../emailService', () => ({ sendEmail: jest.fn() }));

const initialBrevoApiKey = process.env.BREVO_API_KEY;
const { pool } = require('../../config/db');
const emailService = require('../emailService');
const saasMembershipService = require('../saasMembershipService');

describe('saasMembershipService invitation audit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (initialBrevoApiKey === undefined) delete process.env.BREVO_API_KEY;
    else process.env.BREVO_API_KEY = initialBrevoApiKey;
  });

  test('returns structured SaaS quota details when an invitation would exceed team seats', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        if (sql.includes('app_saas_find_user_by_email')) {
          return { rows: [{ id: 42, email: 'new.member@example.com' }] };
        }
        if (sql.includes('SELECT * FROM memberships')) return { rows: [] };
        if (sql.includes('COUNT(*)::int AS count')) return { rows: [{ count: 999 }] };
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    pool.connect.mockResolvedValue(client);

    await expect(saasMembershipService.invite({
      tenantId: 'salon-1',
      tenantName: 'Salón de prueba',
      plan: 'FREEMIUM',
      actorId: 7,
      email: 'new.member@example.com',
      role: 'MEMBER',
    })).rejects.toMatchObject({
      status: 403,
      message: 'Límite de asientos alcanzado',
      details: expect.objectContaining({
        code: 'SAAS_QUOTA_EXCEEDED',
        feature: 'TEAM_SEATS',
        current: 3,
        plan: 'FREE_TRIAL',
        upgradeUrl: '/api/saas/billing/checkout',
      }),
      details: expect.objectContaining({
        code: 'SAAS_QUOTA_EXCEEDED',
        feature: 'TEAM_SEATS',
        current: 999,
        plan: 'FREEMIUM',
        upgradeUrl: '/api/saas/billing/checkout',
      }),
    });

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  test('records the acting user when expiring invitations during invite creation', async () => {
    const calls = [];
    const client = {
      query: jest.fn(async (sql, params = []) => {
        calls.push({ sql, params });
        if (sql.includes('app_saas_find_user_by_email')) {
          return { rows: [{ id: 42, email: 'new.member@example.com' }] };
        }
        if (sql.includes('SELECT * FROM memberships')) return { rows: [] };
        if (sql.includes('COUNT(*)::int AS count')) return { rows: [{ count: 1 }] };
        if (sql.includes('INSERT INTO memberships')) {
          return { rows: [{ id: 91, invite_expires_at: new Date('2026-12-01T00:00:00Z') }] };
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    pool.connect.mockResolvedValue(client);

    await saasMembershipService.invite({
      tenantId: 'salon-1',
      tenantName: 'Salón de prueba',
      plan: 'BASIC',
      actorId: 7,
      email: 'new.member@example.com',
      role: 'MEMBER',
    });

    const inviteInsert = calls.find(({ sql }) => sql.includes('INSERT INTO memberships'));
    expect(inviteInsert.sql).toMatch(/INSERT INTO memberships\s+\(id,/);
    expect(inviteInsert.params[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    const expiryAudit = calls.find(({ sql }) => sql.includes("'INVITATION_EXPIRED'"));
    expect(expiryAudit).toBeDefined();
    expect(expiryAudit.sql).toContain('actor_user_id');
    expect(expiryAudit.params).toEqual(['salon-1', 7]);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  test('rejects a legacy invitation when accepting it would exceed the plan seat limit', async () => {
    const calls = [];
    const client = {
      query: jest.fn(async (sql, params = []) => {
        calls.push({ sql, params });
        if (sql.includes('FROM salon_invitaciones si')) {
          return { rows: [{ id: 12, salon_id: 8, email: 'staff@example.com', sub_rol: 'EMPLEADO',
            creado_por: 7, business_profile_id: 'salon-1', saas_plan: 'FREE_TRIAL', business_name: 'Salón' }] };
        }
        if (sql.includes('SELECT id, status FROM memberships')) return { rows: [] };
        if (sql.includes('SELECT COUNT(*)::int AS count FROM memberships')) return { rows: [{ count: 3 }] };
        return { rows: [], rowCount: 0 };
      }),
      release: jest.fn(),
    };
    pool.connect.mockResolvedValue(client);

    await expect(saasMembershipService.acceptLegacySalonInvitation({
      token: 'a'.repeat(32),
      user: { id: 42, email: 'staff@example.com' },
    })).rejects.toMatchObject({ status: 403, message: 'Límite de asientos alcanzado' });

    expect(calls.some(({ sql }) => sql.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(calls.some(({ sql }) => sql.includes('INSERT INTO memberships'))).toBe(false);
    expect(calls.some(({ sql }) => sql.includes('UPDATE salon_invitaciones SET usado = true'))).toBe(false);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  test('rejects canonical acceptance from an account with a different email', async () => {
    const calls = [];
    const client = {
      query: jest.fn(async (sql, params = []) => {
        calls.push({ sql, params });
        if (sql.includes('SELECT business_profile_id FROM memberships')) {
          return { rows: [{ business_profile_id: 'salon-1' }] };
        }
        if (sql.includes('SELECT m.*, bp.saas_plan, bp.provider_id AS tenant_owner_id FROM memberships m')) {
          return { rows: [{
            id: 'invite-1', business_profile_id: 'salon-1', user_id: 42,
            invite_email: 'sonia@example.com', role: 'MEMBER', status: 'PENDING',
            saas_plan: 'FREE_TRIAL',
            invite_expires_at: new Date(Date.now() + 86400000),
          }] };
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    pool.connect.mockResolvedValue(client);

    await expect(saasMembershipService.accept({
      token: 'a'.repeat(32),
      user: { id: 99, email: 'other@example.com' },
    })).rejects.toMatchObject({ status: 403 });

    expect(calls.some(({ sql }) => sql.includes('UPDATE memberships SET user_id'))).toBe(false);
    expect(calls.some(({ sql }) => sql === 'COMMIT')).toBe(false);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  test('rejects an expired canonical invitation without activating membership', async () => {
    const calls = [];
    const client = {
      query: jest.fn(async (sql, params = []) => {
        calls.push({ sql, params });
        if (sql.includes('SELECT business_profile_id FROM memberships')) {
          return { rows: [{ business_profile_id: 'salon-1' }] };
        }
        if (sql.includes('SELECT m.*, bp.saas_plan, bp.provider_id AS tenant_owner_id FROM memberships m')) {
          return { rows: [{
            id: 'invite-1', business_profile_id: 'salon-1', user_id: 42,
            invite_email: 'staff@example.com', role: 'MEMBER', status: 'PENDING',
            saas_plan: 'FREE_TRIAL',
            invite_expires_at: new Date(Date.now() - 86400000),
          }] };
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    pool.connect.mockResolvedValue(client);

    await expect(saasMembershipService.accept({
      token: 'b'.repeat(32),
      user: { id: 42, email: 'staff@example.com' },
    })).rejects.toMatchObject({ status: 404 });

    expect(calls.some(({ sql }) => sql.includes('UPDATE memberships SET user_id'))).toBe(false);
    expect(calls.some(({ sql }) => sql === 'COMMIT')).toBe(false);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  test('returns 404 when a resend targets an already accepted membership', async () => {
    const calls = [];
    const client = {
      query: jest.fn(async (sql, params = []) => {
        calls.push({ sql, params });
        if (sql.includes('WHERE m.id = $1 AND m.business_profile_id = $2')) return { rows: [] };
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    pool.connect.mockResolvedValue(client);

    await expect(saasMembershipService.resend({
      tenantId: 'salon-1', memberId: 'active-member', actorId: 7,
      tenantName: 'Salón de prueba', plan: 'BASIC',
    })).rejects.toMatchObject({
      status: 404,
      message: 'Invitación pendiente no encontrada',
    });

    expect(calls.some(({ sql }) => sql.includes('UPDATE memberships SET status'))).toBe(false);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  test('resends an expired invitation when a seat is available', async () => {
    process.env.BREVO_API_KEY = 'test-api-key';
    emailService.sendEmail.mockResolvedValue({ devMode: false });
    const calls = [];
    const client = {
      query: jest.fn(async (sql, params = []) => {
        calls.push({ sql, params });
        if (sql.includes('WHERE m.id = $1 AND m.business_profile_id = $2')) {
          return { rows: [{
            id: 'expired-invite', business_profile_id: 'salon-1', user_id: 42,
            email: 'expired.member@example.com', role: 'MEMBER', status: 'EXPIRED',
          }] };
        }
        if (sql.includes('COUNT(*)::int AS count')) return { rows: [{ count: 4 }] };
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    pool.connect.mockResolvedValue(client);

    await expect(saasMembershipService.resend({
      tenantId: 'salon-1', memberId: 'expired-invite', actorId: 7,
      tenantName: 'Salón de prueba', plan: 'BASIC',
    })).resolves.toEqual({ emailSent: true });

    expect(calls.some(({ sql, params }) =>
      sql.includes("UPDATE memberships SET status = 'PENDING'") && params[2] === 7 && params[3] === 'expired-invite'
    )).toBe(true);
    expect(calls.some(({ sql, params }) =>
      sql.includes('INSERT INTO membership_audit_logs') && params[3] === 'INVITATION_RESENT'
    )).toBe(true);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'expired.member@example.com' })
    );
    expect(client.release).toHaveBeenCalled();
  });

  test('rejects expired invitation resend at the seat limit without sending email', async () => {
    process.env.BREVO_API_KEY = 'test-api-key';
    const calls = [];
    const client = {
      query: jest.fn(async (sql, params = []) => {
        calls.push({ sql, params });
        if (sql.includes('WHERE m.id = $1 AND m.business_profile_id = $2')) {
          return { rows: [{
            id: 'expired-invite', business_profile_id: 'salon-1', user_id: 42,
            email: 'expired.member@example.com', role: 'MEMBER', status: 'EXPIRED',
          }] };
        }
        if (sql.includes('COUNT(*)::int AS count')) return { rows: [{ count: 5 }] };
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    pool.connect.mockResolvedValue(client);

    await expect(saasMembershipService.resend({
      tenantId: 'salon-1', memberId: 'expired-invite', actorId: 7,
      tenantName: 'Salón de prueba', plan: 'BASIC',
    })).rejects.toMatchObject({
      status: 403,
      message: 'Límite de asientos alcanzado para reenviar la invitación',
      details: expect.objectContaining({
        code: 'SAAS_QUOTA_EXCEEDED',
        feature: 'TEAM_SEATS',
        current: 5,
        plan: 'BASIC',
      }),
    });

    expect(calls.some(({ sql }) => sql.includes("UPDATE memberships SET status = 'PENDING'"))).toBe(false);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(emailService.sendEmail).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalled();
  });

  test('does not reactivate a suspended member after the canonical plan loses team management', async () => {
    const calls = [];
    const client = {
      query: jest.fn(async (sql) => {
        calls.push(sql);
        if (sql.includes('SELECT * FROM memberships WHERE id = $1 AND business_profile_id = $2')) {
          return { rows: [{ id: 'member-1', role: 'MEMBER', user_id: 42, status: 'SUSPENDED' }] };
        }
        if (sql.includes('SELECT saas_plan FROM business_profiles')) return { rows: [{ saas_plan: 'FREEMIUM' }] };
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    pool.connect.mockResolvedValue(client);

    await expect(saasMembershipService.setStatus({
      tenantId: 'salon-1', memberId: 'member-1', actorId: 7, status: 'ACTIVE', plan: 'BASIC',
    })).rejects.toMatchObject({
      status: 403,
      message: 'El plan actual no permite reactivar miembros del equipo.',
      details: { code: 'TEAM_MANAGEMENT_NOT_INCLUDED', currentPlan: 'FREEMIUM' },
    });

    expect(calls.some((sql) => sql.includes('COUNT(*)::int AS count'))).toBe(false);
    expect(calls.some((sql) => sql.includes('UPDATE memberships SET status'))).toBe(false);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  test('reactivates a suspended member when the current plan includes team management and has a seat', async () => {
    const calls = [];
    const client = {
      query: jest.fn(async (sql) => {
        calls.push(sql);
        if (sql.includes('SELECT * FROM memberships WHERE id = $1 AND business_profile_id = $2')) {
          return { rows: [{ id: 'member-1', role: 'MEMBER', user_id: 42, status: 'SUSPENDED' }] };
        }
        if (sql.includes('SELECT saas_plan FROM business_profiles')) return { rows: [{ saas_plan: 'BASIC' }] };
        if (sql.includes('COUNT(*)::int AS count')) return { rows: [{ count: 2 }] };
        if (sql.includes('UPDATE memberships SET status')) return { rows: [{ id: 'member-1', status: 'ACTIVE' }] };
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    pool.connect.mockResolvedValue(client);

    await expect(saasMembershipService.setStatus({
      tenantId: 'salon-1', memberId: 'member-1', actorId: 7, status: 'ACTIVE', plan: 'FREEMIUM',
    })).resolves.toMatchObject({ id: 'member-1', status: 'ACTIVE' });

    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

});

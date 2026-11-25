jest.mock('../../config/db', () => ({
  pool: { connect: jest.fn() },
}));

const { pool } = require('../../config/db');
const saasMembershipService = require('../saasMembershipService');

describe('saasMembershipService invitation audit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
        if (sql.includes('SELECT m.* FROM memberships m')) {
          return { rows: [{
            id: 'invite-1', business_profile_id: 'salon-1', user_id: 42,
            invite_email: 'sonia@example.com', role: 'MEMBER', status: 'PENDING',
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
        if (sql.includes('SELECT m.* FROM memberships m')) {
          return { rows: [{
            id: 'invite-1', business_profile_id: 'salon-1', user_id: 42,
            invite_email: 'staff@example.com', role: 'MEMBER', status: 'PENDING',
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
});

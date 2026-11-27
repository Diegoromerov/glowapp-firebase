const mockPoolConnect = jest.fn();

jest.mock('../config/db', () => ({ pool: { connect: (...args) => mockPoolConnect(...args) } }));
jest.mock('../services/usageMeteringService', () => ({ getLimit: jest.fn(() => 3) }));
jest.mock('../services/emailService', () => ({ sendEmail: jest.fn() }));

const membershipService = require('../services/saasMembershipService');
const usageMeteringService = require('../services/usageMeteringService');

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const USER = { id: 42, email: 'colaborador@glow.app' };

function makeClient({ existing = [], occupied = 1, invite = true, plan = 'FREE_TRIAL' } = {}) {
  const calls = [];
  const client = {
    release: jest.fn(),
    query: jest.fn(async (sql, params = []) => {
      calls.push({ sql: String(sql), params });
      const statement = String(sql);
      if (statement === 'BEGIN' || statement === 'COMMIT' || statement === 'ROLLBACK') return { rows: [] };
      if (statement.includes('FROM salon_invitaciones si')) {
        return { rows: invite ? [{ id: 7, salon_id: 3, business_profile_id: 'bp-3', saas_plan: plan, business_name: 'QA', email: USER.email, sub_rol: 'EMPLEADO', creado_por: 10 }] : [] };
      }
      if (statement.includes('FROM business_profiles')) return { rows: [{ id: 'bp-3' }] };
      if (statement.includes('FROM memberships') && statement.includes('user_id = $2')) return { rows: existing };
      if (statement.includes('COUNT(*)::int')) return { rows: [{ count: occupied }] };
      if (statement.startsWith('INSERT INTO memberships')) return { rows: [{ id: 'm-new', business_profile_id: 'bp-3', user_id: USER.id, role: 'MEMBER', sub_rol: 'EMPLEADO', status: 'ACTIVE' }] };
      if (statement.startsWith('UPDATE salon_invitaciones')) return { rowCount: 1, rows: [] };
      return { rows: [] };
    }),
  };
  return { client, calls };
}

describe('acceptLegacySalonInvitation', () => {
  beforeEach(() => {
    mockPoolConnect.mockReset();
    usageMeteringService.getLimit.mockReset().mockReturnValue(3);
  });

  test('acepta el legado en una transacción, reserva cupo y audita', async () => {
    const { client, calls } = makeClient({ occupied: 1 });
    mockPoolConnect.mockResolvedValue(client);

    const membership = await membershipService.acceptLegacySalonInvitation({ token: TOKEN, user: USER });

    expect(membership).toMatchObject({ id: 'm-new', role: 'MEMBER', status: 'ACTIVE' });
    expect(calls[0].sql).toBe('BEGIN');
    expect(calls.some(({ sql }) => sql.includes('pg_advisory_xact_lock(hashtextextended($1, 0))'))).toBe(true);
    expect(calls.some(({ sql }) => sql.includes('FOR UPDATE OF si'))).toBe(true);
    expect(calls.some(({ sql }) => sql.includes('COUNT(*)::int') && sql.includes("'ACTIVE','PENDING','INVITED'"))).toBe(true);
    expect(calls.some(({ sql }) => sql.startsWith('INSERT INTO membership_audit_logs'))).toBe(true);
    expect(calls.some(({ sql }) => sql.startsWith('UPDATE salon_invitaciones'))).toBe(true);
    expect(calls.at(-1).sql).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('rechaza aceptación cuando el equipo ya llegó al cupo y no consume la invitación', async () => {
    const { client, calls } = makeClient({ occupied: 3 });
    mockPoolConnect.mockResolvedValue(client);

    await expect(membershipService.acceptLegacySalonInvitation({ token: TOKEN, user: USER }))
      .rejects.toMatchObject({ status: 403, details: { current: 3, limit: 3 } });

    expect(calls.some(({ sql }) => sql.startsWith('INSERT INTO memberships'))).toBe(false);
    expect(calls.some(({ sql }) => sql.startsWith('UPDATE salon_invitaciones'))).toBe(false);
    expect(calls.at(-1).sql).toBe('ROLLBACK');
  });

  test('rechaza invitación heredada si el plan no incluye gestión de equipo, aunque exista cupo', async () => {
    const { client, calls } = makeClient({ plan: 'FREEMIUM', occupied: 0 });
    mockPoolConnect.mockResolvedValue(client);

    await expect(membershipService.acceptLegacySalonInvitation({ token: TOKEN, user: USER }))
      .rejects.toMatchObject({
        status: 403,
        details: { code: 'TEAM_MANAGEMENT_NOT_INCLUDED', currentPlan: 'FREEMIUM' },
      });

    expect(calls.some(({ sql }) => sql.includes('COUNT(*)::int'))).toBe(false);
    expect(calls.some(({ sql }) => sql.startsWith('INSERT INTO memberships'))).toBe(false);
    expect(calls.some(({ sql }) => sql.startsWith('UPDATE salon_invitaciones'))).toBe(false);
    expect(calls.at(-1).sql).toBe('ROLLBACK');
  });

  test('rechaza correo distinto antes de crear una membresía', async () => {
    const { client, calls } = makeClient();
    mockPoolConnect.mockResolvedValue(client);

    await expect(membershipService.acceptLegacySalonInvitation({ token: TOKEN, user: { id: 44, email: 'otro@glow.app' } }))
      .rejects.toMatchObject({ status: 403, code: 'INVITATION_EMAIL_MISMATCH' });

    expect(calls.some(({ sql }) => sql.startsWith('INSERT INTO memberships'))).toBe(false);
    expect(calls.at(-1).sql).toBe('ROLLBACK');
  });

  test('no reactiva membresías existentes por medio de un enlace antiguo', async () => {
    const { client, calls } = makeClient({ existing: [{ id: 'm-old', status: 'REMOVED' }] });
    mockPoolConnect.mockResolvedValue(client);

    await expect(membershipService.acceptLegacySalonInvitation({ token: TOKEN, user: USER }))
      .rejects.toMatchObject({ status: 409 });

    expect(calls.some(({ sql }) => sql.startsWith('INSERT INTO memberships'))).toBe(false);
    expect(calls.some(({ sql }) => sql.startsWith('UPDATE salon_invitaciones'))).toBe(false);
  });

  test('rechaza tokens con formato inválido antes de abrir conexión', async () => {
    await expect(membershipService.acceptLegacySalonInvitation({ token: 'mal', user: USER }))
      .rejects.toMatchObject({ status: 400 });
    expect(mockPoolConnect).not.toHaveBeenCalled();
  });
});


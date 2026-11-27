const mockPoolConnect = jest.fn();

jest.mock('../config/db', () => ({ pool: { connect: (...args) => mockPoolConnect(...args) } }));
jest.mock('../services/usageMeteringService', () => ({ getLimit: jest.fn() }));
jest.mock('../services/emailService', () => ({ sendEmail: jest.fn() }));

const membershipService = require('../services/saasMembershipService');

function makeClient(target, plan = 'BASIC') {
  const calls = [];
  const client = {
    release: jest.fn(),
    query: jest.fn(async (sql, params = []) => {
      calls.push({ sql: String(sql), params });
      const statement = String(sql);
      if (statement === 'BEGIN' || statement === 'COMMIT' || statement === 'ROLLBACK') return { rows: [] };
      if (statement.startsWith('SELECT saas_plan FROM business_profiles')) return { rows: [{ saas_plan: plan }] };
      if (statement.startsWith('SELECT * FROM memberships')) return { rows: target ? [target] : [] };
      if (statement.startsWith('UPDATE memberships SET role')) {
        return { rows: [{ ...target, role: params[0], sub_rol: params[1] }] };
      }
      return { rows: [] };
    }),
  };
  return { client, calls };
}

describe('changeRole compatibility for salon legacy routes', () => {
  beforeEach(() => mockPoolConnect.mockReset());

  test('preserves PRESTADOR_INDEPENDIENTE while changing the canonical MEMBER role', async () => {
    const { client, calls } = makeClient({ id: 'm-1', user_id: 41, role: 'MEMBER', status: 'ACTIVE' });
    mockPoolConnect.mockResolvedValue(client);

    const updated = await membershipService.changeRole({
      tenantId: 'bp-3', memberId: 'm-1', actorId: 10, role: 'MEMBER', subRole: 'PRESTADOR_INDEPENDIENTE',
    });

    expect(updated.sub_rol).toBe('PRESTADOR_INDEPENDIENTE');
    const update = calls.find(({ sql }) => sql.startsWith('UPDATE memberships SET role'));
    expect(update.params).toEqual(['MEMBER', 'PRESTADOR_INDEPENDIENTE', 'm-1']);
    expect(calls.some(({ sql }) => sql.startsWith('INSERT INTO membership_audit_logs'))).toBe(true);
    expect(calls.at(-1).sql).toBe('COMMIT');
  });

  test('rejects a legacy label that would grant a different canonical role', async () => {
    const { client, calls } = makeClient({ id: 'm-1', user_id: 41, role: 'MEMBER', status: 'ACTIVE' });
    mockPoolConnect.mockResolvedValue(client);

    await expect(membershipService.changeRole({
      tenantId: 'bp-3', memberId: 'm-1', actorId: 10, role: 'ADMIN', subRole: 'EMPLEADO',
    })).rejects.toMatchObject({ status: 400 });

    expect(calls.some(({ sql }) => sql.startsWith('UPDATE memberships SET role'))).toBe(false);
    expect(calls.at(-1).sql).toBe('ROLLBACK');
  });

  test('does not change roles when the current plan no longer includes team management', async () => {
    const { client, calls } = makeClient({ id: 'm-1', user_id: 41, role: 'MEMBER', status: 'ACTIVE' }, 'FREEMIUM');
    mockPoolConnect.mockResolvedValue(client);

    await expect(membershipService.changeRole({
      tenantId: 'bp-3', memberId: 'm-1', actorId: 10, role: 'ADMIN',
    })).rejects.toMatchObject({
      status: 403,
      details: { code: 'TEAM_MANAGEMENT_NOT_INCLUDED', currentPlan: 'FREEMIUM' },
    });

    expect(calls.some(({ sql }) => sql.startsWith('UPDATE memberships SET role'))).toBe(false);
    expect(calls.at(-1).sql).toBe('ROLLBACK');
  });
});

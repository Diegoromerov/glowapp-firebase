const mockRunInTenantTransaction = jest.fn();

jest.mock('../src/config/db', () => ({
  pool: { query: jest.fn(), connect: jest.fn() },
}));

jest.mock('../src/config/tenantRouting', () => ({
  runInTenantTransaction: (...args) => mockRunInTenantTransaction(...args),
}));

const { pool } = require('../src/config/db');
const { getActiveMembership } = require('../src/middleware/ownerGuard');

describe('ownerGuard tenant transaction contract', () => {
  beforeEach(() => {
    mockRunInTenantTransaction.mockReset();
  });

  test('passes the authenticated user id and callback in the four-argument transaction contract', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        if (sql.includes('SELECT tenant_id FROM usuarios')) {
          return { rows: [{ tenant_id: 8 }] };
        }
        if (sql.includes('JOIN memberships')) return { rows: [] };
        return { rows: [] };
      }),
    };
    mockRunInTenantTransaction.mockImplementation(
      async (_deps, _tenantId, _userId, callback) => callback(client),
    );

    const membership = await getActiveMembership(11, 42, null);

    expect(membership).toBeNull();
    expect(mockRunInTenantTransaction).toHaveBeenCalledWith(
      { pool },
      null,
      42,
      expect.any(Function),
    );
    expect(client.query).toHaveBeenCalledWith(
      "SELECT set_config('app.user_id', $1, true)",
      ['42'],
    );
    expect(client.query).toHaveBeenCalledWith(
      "SELECT set_config('app.tenant_id', $1, true)",
      ['8'],
    );
  });
});

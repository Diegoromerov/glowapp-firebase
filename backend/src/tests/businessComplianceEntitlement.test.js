jest.mock('../config/db', () => ({ pool: {} }));
jest.mock('../config/tenantRouting', () => ({
  runInTenantTransaction: jest.fn(),
}));

const { runInTenantTransaction } = require('../config/tenantRouting');
const { withBusinessComplianceRead } = require('../services/usageMeteringService');

describe('withBusinessComplianceRead', () => {
  const client = { query: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    runInTenantTransaction.mockImplementation(async (_pool, _tenantId, _userId, callback) => callback(client));
    client.query.mockImplementation(async (sql) => {
      if (sql.includes('set_config')) return { rows: [] };
      return { rows: [{ saas_plan: 'BASIC', role: 'OWNER' }] };
    });
  });

  test('requires a valid active SaaS context', async () => {
    await expect(withBusinessComplianceRead({ tenantId: null, userId: 7 }))
      .resolves.toMatchObject({ allowed: false, reason: 'SaaS context required' });
    expect(runInTenantTransaction).not.toHaveBeenCalled();
  });

  test('requires active membership in the selected tenant', async () => {
    client.query.mockImplementation(async (sql) => sql.includes('set_config')
      ? { rows: [] }
      : { rows: [] });

    await expect(withBusinessComplianceRead({ tenantId: 'salon-1', userId: 7 }))
      .resolves.toMatchObject({ allowed: false, reason: 'Active membership required' });
  });

  test('rejects Freemium even with an active owner membership', async () => {
    client.query.mockImplementation(async (sql) => sql.includes('set_config')
      ? { rows: [] }
      : { rows: [{ saas_plan: 'FREEMIUM', role: 'OWNER' }] });

    await expect(withBusinessComplianceRead({ tenantId: 'salon-1', userId: 7 }))
      .resolves.toMatchObject({ allowed: false, reason: 'Feature not included in plan', plan: 'FREEMIUM' });
  });

  test('permits a role with read permission when the tenant plan includes compliance', async () => {
    await expect(withBusinessComplianceRead({ tenantId: 'salon-1', userId: 7 }))
      .resolves.toMatchObject({ allowed: true, plan: 'BASIC', role: 'OWNER' });
    expect(runInTenantTransaction).toHaveBeenCalledWith(expect.anything(), 'salon-1', 7, expect.any(Function));
  });

  test('executes the authorized read inside the same RLS transaction', async () => {
    const read = jest.fn().mockResolvedValue('salon data');
    const result = await withBusinessComplianceRead({ tenantId: 'salon-1', userId: 7, read });
    expect(result.data).toBe('salon data');
    expect(read).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('set_config'))).toBe(true);
  });
});


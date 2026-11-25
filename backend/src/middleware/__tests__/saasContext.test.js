/**
 * Tests para saasContext.js middleware
 * Verifica resolución de contexto SaaS desde memberships
 */
const saasContext = require('../saasContext');
const { pool } = require('../../config/db');
let transactionClient;
const tenantRouting = require('../../config/tenantRouting');

jest.mock('../../config/tenantRouting', () => ({ getActiveClient: jest.fn() }));

// Mock de pool.query
jest.mock('../../config/db', () => ({
  pool: {
    query: jest.fn()
  }
}));

describe('saasContext middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = { user: null };
    res = { 
      status: jest.fn().mockReturnThis(), 
      json: jest.fn() 
    };
    next = jest.fn();
    jest.clearAllMocks();
    transactionClient = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    tenantRouting.getActiveClient.mockReturnValue(transactionClient);
  });

  test('sin usuario autenticado → req.saas = null, next()', async () => {
    req.user = null;
    
    await saasContext(req, res, next);
    
    expect(req.saas).toBeNull();
    expect(next).toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('usuario sin membership activa → req.saas = null, next()', async () => {
    req.user = { id: 1, email: 'test@test.com' };
    transactionClient.query.mockResolvedValue({ rows: [] });
    
    await saasContext(req, res, next);
    
    expect(req.saas).toBeNull();
    expect(next).toHaveBeenCalled();
    expect(transactionClient.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT m.*, bp.saas_plan'),
      [1, null]
    );
  });

  test('usuario con membership activa → req.saas poblado con tenant, plan, role, capabilities', async () => {
    req.user = { id: 1, email: 'owner@test.com' };
    transactionClient.query.mockResolvedValue({
      rows: [{
        id: 'm_123',
        business_profile_id: 'bp_456',
        business_name: 'Salón Bella',
        saas_plan: 'PRO',
        role: 'OWNER',
        active_salon_id: 42,
        accepted_at: '2024-01-15T10:00:00Z'
      }] 
    });
    
    await saasContext(req, res, next);
    
    expect(req.saas).toEqual({
      tenantId: 'bp_456',
      salonId: 42,
      name: 'Salón Bella',
      plan: 'PRO',
      role: 'OWNER',
      membershipId: 'm_123',
      capabilities: expect.arrayContaining([
        'MAP_VISIBILITY',
        'TEAM_MANAGEMENT',
        'ONLINE_BOOKING',
        'ADVANCED_ANALYTICS',
        'CUSTOM_BRANDING'
      ])
    });
    expect(tenantRouting.getActiveClient().query).toHaveBeenCalledWith(
      "SELECT set_config('app.business_profile_id', $1, true)", ['bp_456']
    );
    expect(next).toHaveBeenCalled();
  });

  test('membership con plan FREEMIUM → capabilities limitadas', async () => {
    req.user = { id: 2 };
    transactionClient.query.mockResolvedValue({
      rows: [{
        id: 'm_456',
        business_profile_id: 'bp_789',
        name: 'Salón Free',
        saas_plan: 'FREEMIUM',
        role: 'MEMBER',
        accepted_at: '2024-01-15T10:00:00Z'
      }] 
    });
    
    await saasContext(req, res, next);
    
    expect(req.saas.plan).toBe('FREEMIUM');
    expect(req.saas.capabilities).not.toContain('ADVANCED_ANALYTICS');
    expect(req.saas.capabilities).not.toContain('CUSTOM_BRANDING');
    expect(req.saas.capabilities).toContain('MAP_VISIBILITY');
  });

  test('múltiples memberships → usa la más reciente accepted_at', async () => {
    req.user = { id: 3 };
    // Query ordena por accepted_at DESC, así que la más reciente debe ser la primera en el resultado
    transactionClient.query.mockResolvedValue({
      rows: [
        { id: 'm_new', business_profile_id: 'bp_new', name: 'New', saas_plan: 'PRO', role: 'OWNER', accepted_at: '2024-06-01T10:00:00Z' },
        { id: 'm_old', business_profile_id: 'bp_old', name: 'Old', saas_plan: 'BASIC', role: 'MEMBER', accepted_at: '2024-01-01T10:00:00Z' }
      ] 
    });
    
    await saasContext(req, res, next);
    
    expect(req.saas.tenantId).toBe('bp_new');
    expect(req.saas.plan).toBe('PRO');
    expect(req.saas.role).toBe('OWNER');
  });

  test('la sede activa de la petición se aplica al resolver la membership', async () => {
    req.user = { id: 7 };
    req.headers = { 'x-active-salon-id': '42' };
    transactionClient.query.mockResolvedValue({ rows: [{ id: 'm-42', business_profile_id: 'bp-42', active_salon_id: 42, saas_plan: 'BASIC', role: 'OWNER' }] });

    await saasContext(req, res, next);

    expect(transactionClient.query).toHaveBeenCalledWith(expect.stringContaining('s.business_profile_id = bp.id'), [7, 42]);
    expect(req.saas.salonId).toBe(42);
    expect(next).toHaveBeenCalled();
  });

  test('rechaza una sede activa con formato inválido', async () => {
    req.user = { id: 7 };
    req.headers = { 'x-active-salon-id': 'salon-42' };

    await saasContext(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('error al establecer el alcance SaaS en BD → cierra la petición con 503', async () => {
    req.user = { id: 1 };
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT m.*, bp.saas_plan')) return { rows: [{
        id: 'm_123', business_profile_id: 'bp_456', business_name: 'Salón',
        saas_plan: 'PRO', role: 'OWNER', active_salon_id: 42,
      }] };
      return { rows: [] };
    });
    const transactionQuery = jest.fn().mockRejectedValue(new Error('Connection refused while setting business scope'));
    tenantRouting.getActiveClient.mockReturnValue({ query: transactionQuery });
    
    await saasContext(req, res, next);
    
    expect(req.saas).toBeNull();
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });
});

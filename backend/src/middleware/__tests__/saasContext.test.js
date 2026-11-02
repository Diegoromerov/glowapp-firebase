/**
 * Tests para saasContext.js middleware
 * Verifica resolución de contexto SaaS desde memberships
 */
const saasContext = require('../saasContext');
const { pool } = require('../../config/db');

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
    pool.query.mockResolvedValue({ rows: [] });
    
    await saasContext(req, res, next);
    
    expect(req.saas).toBeNull();
    expect(next).toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT m.*, bp.saas_plan'),
      [1]
    );
  });

  test('usuario con membership activa → req.saas poblado con tenant, plan, role, capabilities', async () => {
    req.user = { id: 1, email: 'owner@test.com' };
    pool.query.mockResolvedValue({ 
      rows: [{
        id: 'm_123',
        business_profile_id: 'bp_456',
        business_name: 'Salón Bella',
        saas_plan: 'PRO',
        role: 'OWNER',
        accepted_at: '2024-01-15T10:00:00Z'
      }] 
    });
    
    await saasContext(req, res, next);
    
    expect(req.saas).toEqual({
      tenantId: 'bp_456',
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
    expect(next).toHaveBeenCalled();
  });

  test('membership con plan FREEMIUM → capabilities limitadas', async () => {
    req.user = { id: 2 };
    pool.query.mockResolvedValue({ 
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
    expect(req.saas.capabilities).not.toContain('MAP_VISIBILITY');
  });

  test('múltiples memberships → usa la más reciente accepted_at', async () => {
    req.user = { id: 3 };
    // Query ordena por accepted_at DESC, así que la más reciente debe ser la primera en el resultado
    pool.query.mockResolvedValue({ 
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

  test('error en BD → fail-open: req.saas = null, next() sin romper', async () => {
    req.user = { id: 1 };
    pool.query.mockRejectedValue(new Error('Connection refused'));
    
    await saasContext(req, res, next);
    
    expect(req.saas).toBeNull();
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
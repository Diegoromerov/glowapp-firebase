/**
 * Tests para featureGate.js middleware
 * Verifica requireEntitlement, requireRole, requireOwner
 */
const { requireEntitlement, requireRole, requireOwner } = require('../featureGate');

describe('featureGate middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = { saas: null };
    res = { 
      status: jest.fn().mockReturnThis(), 
      json: jest.fn() 
    };
    next = jest.fn();
    jest.clearAllMocks();
  });

  describe('requireEntitlement', () => {
    test('sin req.saas → 401 Contexto SaaS requerido', () => {
      const middleware = requireEntitlement('ADVANCED_ANALYTICS');
      req.saas = null;
      
      middleware(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Contexto SaaS requerido' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('con saas pero sin entitlement → 403 Plan no incluye esta función', () => {
      const middleware = requireEntitlement('ADVANCED_ANALYTICS');
      req.saas = { plan: 'FREEMIUM', capabilities: ['ONLINE_BOOKING'] };
      
      middleware(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ 
          error: 'Plan no incluye esta función',
          required: 'ADVANCED_ANALYTICS',
          currentPlan: 'FREEMIUM'
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('con saas y entitlement → next()', () => {
      const middleware = requireEntitlement('ONLINE_BOOKING');
      req.saas = { plan: 'PRO', capabilities: ['ONLINE_BOOKING', 'ADVANCED_ANALYTICS'] };
      
      middleware(req, res, next);
      
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('entitlement en plan ENTERPRISE (ilimitado) → next()', () => {
      const middleware = requireEntitlement('CUSTOM_BRANDING');
      req.saas = { plan: 'ENTERPRISE', capabilities: ['CUSTOM_BRANDING'] };
      
      middleware(req, res, next);
      
      expect(next).toHaveBeenCalled();
    });
  });

  describe('requireRole', () => {
    test('sin req.saas → 401', () => {
      const middleware = requireRole('ADMIN');
      req.saas = null;
      
      middleware(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('rol OWNER ≥ ADMIN → next()', () => {
      const middleware = requireRole('ADMIN');
      req.saas = { role: 'OWNER' };
      
      middleware(req, res, next);
      
      expect(next).toHaveBeenCalled();
    });

    test('rol ADMIN ≥ ADMIN → next()', () => {
      const middleware = requireRole('ADMIN');
      req.saas = { role: 'ADMIN' };
      
      middleware(req, res, next);
      
      expect(next).toHaveBeenCalled();
    });

    test('rol MANAGER < ADMIN → 403 Rol insuficiente', () => {
      const middleware = requireRole('ADMIN');
      req.saas = { role: 'MANAGER' };
      
      middleware(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ 
          error: 'Rol insuficiente',
          required: 'ADMIN',
          currentRole: 'MANAGER'
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('rol MEMBER < MANAGER → 403', () => {
      const middleware = requireRole('MANAGER');
      req.saas = { role: 'MEMBER' };
      
      middleware(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    test('rol VIEWER (mínimo) → 403 para cualquier requireRole > VIEWER', () => {
      const middleware = requireRole('MEMBER');
      req.saas = { role: 'VIEWER' };
      
      middleware(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('rol desconocido → nivel 0 (bloquea todo)', () => {
      const middleware = requireRole('MEMBER');
      req.saas = { role: 'UNKNOWN_ROLE' };
      
      middleware(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('requireOwner', () => {
    test('sin req.saas → 401', () => {
      req.saas = null;
      
      requireOwner(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('rol OWNER → next()', () => {
      req.saas = { role: 'OWNER' };
      
      requireOwner(req, res, next);
      
      expect(next).toHaveBeenCalled();
    });

    test('rol ADMIN → 403 Solo el propietario', () => {
      req.saas = { role: 'ADMIN' };
      
      requireOwner(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ 
          error: 'Solo el propietario puede realizar esta acción',
          currentRole: 'ADMIN'
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('rol MEMBER → 403', () => {
      req.saas = { role: 'MEMBER' };
      
      requireOwner(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });
});
// backend/src/tests/membership-flow.test.js
const jwt = require('jsonwebtoken');
const membershipMiddleware = require('../middleware/membership.middleware');
const { switchContext } = require('../controllers/authController');
const { Membership, BusinessProfile, User } = require('../models');
const { getJwtSecret } = require('../config/jwt');

describe('Suite de Integración: SaaS Membership & Active Context (Fase 2B.3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. membership.middleware.js', () => {
    test('Rechaza con 401 si req.user no existe', async () => {
      const req = {};
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      await membershipMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'UNAUTHORIZED' }));
      expect(next).not.toHaveBeenCalled();
    });

    test('Regla de 0: Rechaza con 403 (NO_ACTIVE_MEMBERSHIP) si el usuario no tiene membresías activas', async () => {
      const req = { user: { id: 999 } };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      jest.spyOn(Membership, 'findAll').mockResolvedValue([]);

      await membershipMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'NO_ACTIVE_MEMBERSHIP' }));
      expect(next).not.toHaveBeenCalled();
    });

    test('Regla de 1: Auto-selecciona el contexto si el usuario tiene exactamente 1 membresía activa', async () => {
      const req = { user: { id: 101 } };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      const mockMembership = {
        id: 'mem-uuid-1',
        user_id: 101,
        business_profile_id: 'bp-uuid-1',
        role: 'OWNER',
        status: 'ACTIVE',
        businessProfile: { id: 'bp-uuid-1', name: 'Salón Central', city: 'Bogotá' }
      };

      jest.spyOn(Membership, 'findAll').mockResolvedValue([mockMembership]);

      await membershipMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user.businessProfileId).toBe('bp-uuid-1');
      expect(req.user.membershipRole).toBe('OWNER');
      expect(req.membership).toBe(mockMembership);
    });

    test('Regla de N: Exige selección explícita (MULTIPLE_CONTEXTS_REQUIRE_SELECTION) si hay múltiples membresías y no se envió businessProfileId', async () => {
      const req = { user: { id: 102 } };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      const mockMemberships = [
        {
          id: 'mem-uuid-1',
          user_id: 102,
          business_profile_id: 'bp-uuid-1',
          role: 'ADMIN',
          status: 'ACTIVE',
          businessProfile: { id: 'bp-uuid-1', name: 'Sede Norte', city: 'Bogotá' }
        },
        {
          id: 'mem-uuid-2',
          user_id: 102,
          business_profile_id: 'bp-uuid-2',
          role: 'MEMBER',
          status: 'ACTIVE',
          businessProfile: { id: 'bp-uuid-2', name: 'Sede Sur', city: 'Medellín' }
        }
      ];

      jest.spyOn(Membership, 'findAll').mockResolvedValue(mockMemberships);

      await membershipMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'MULTIPLE_CONTEXTS_REQUIRE_SELECTION',
        available_contexts: expect.arrayContaining([
          expect.objectContaining({ business_profile_id: 'bp-uuid-1', role: 'ADMIN' }),
          expect.objectContaining({ business_profile_id: 'bp-uuid-2', role: 'MEMBER' })
        ])
      }));
      expect(next).not.toHaveBeenCalled();
    });

    test('Valida membresía activa cuando se especifica targetBusinessProfileId', async () => {
      const req = {
        user: { id: 103, businessProfileId: 'bp-uuid-3' }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      const mockMembership = {
        id: 'mem-uuid-3',
        user_id: 103,
        business_profile_id: 'bp-uuid-3',
        role: 'MANAGER',
        status: 'ACTIVE'
      };

      jest.spyOn(Membership, 'findOne').mockResolvedValue(mockMembership);

      await membershipMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user.membershipRole).toBe('MANAGER');
      expect(req.membership).toBe(mockMembership);
    });

    test('Rechaza con 403 (MEMBERSHIP_INACTIVE_OR_INVALID) si la membresía no existe o está SUSPENDED/REVOKED', async () => {
      const req = {
        user: { id: 104, businessProfileId: 'bp-uuid-4' }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      // Membresía no encontrada o status !== ACTIVE
      jest.spyOn(Membership, 'findOne').mockResolvedValue(null);

      await membershipMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'MEMBERSHIP_INACTIVE_OR_INVALID' }));
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('2. POST /api/auth/context/switch (switchContext)', () => {
    test('Rechaza con 400 si business_profile_id está ausente', async () => {
      const req = { user: { id: 105 }, body: {} };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      await switchContext(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      // El contrato de validacion del proyecto es { error: 'VALIDATION_ERROR', message, details }
      // (authController.js:31, y lo asertan authZodValidation / biometric.integration / ...).
      // Esta asercion es de antes de la capa Zod y esperaba el mensaje dentro de `error`.
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'VALIDATION_ERROR',
        message: 'business_profile_id es obligatorio',
      }));
    });

    test('Rechaza con 403 si el usuario no tiene membresía activa en el business_profile_id solicitado', async () => {
      const req = {
        user: { id: 105, email: 'user105@demo.com', role: 'salon' },
        body: { business_profile_id: 'bp-ajeno' }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      jest.spyOn(Membership, 'findOne').mockResolvedValue(null);

      await switchContext(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'MEMBERSHIP_NOT_FOUND_OR_INACTIVE' }));
    });

    test('Emite nuevo JWT con el nuevo businessProfileId si la membresía es ACTIVE', async () => {
      const req = {
        user: { id: 106, email: 'owner@demo.com', role: 'salon', rol: 'SALON' },
        body: { business_profile_id: 'bp-valido-106' }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      const mockMembership = {
        id: 'mem-106',
        user_id: 106,
        business_profile_id: 'bp-valido-106',
        role: 'OWNER',
        status: 'ACTIVE',
        businessProfile: { id: 'bp-valido-106', name: 'Estudio Alpha' }
      };

      jest.spyOn(Membership, 'findOne').mockResolvedValue(mockMembership);

      await switchContext(req, res);

      expect(res.json).toHaveBeenCalled();
      const responseData = res.json.mock.calls[0][0];
      expect(responseData.success).toBe(true);
      expect(responseData.token).toBeDefined();

      // Verificar que el token decodificado contiene el nuevo businessProfileId
      const decoded = jwt.verify(responseData.token, getJwtSecret());
      expect(decoded.id).toBe(106);
      expect(decoded.businessProfileId).toBe('bp-valido-106');
      expect(responseData.active_context.business_profile_id).toBe('bp-valido-106');
      expect(responseData.active_context.role).toBe('OWNER');
    });
  });
});

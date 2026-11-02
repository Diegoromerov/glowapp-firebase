// backend/src/tests/rbac-flow.test.js
const { AuthorizationService, RESOURCES, ACTIONS, ROLES } = require('../services/authorizationService');
const { requirePermission } = require('../middleware/authorization.middleware');

describe('Suite de Pruebas: Authorization & RBAC Foundation (Fase 2B.4)', () => {
  describe('1. AuthorizationService — Matriz de Permisos & Deny-by-Default', () => {
    test('Deny-by-default: Rechaza roles, recursos o acciones indefinidos o inválidos', () => {
      expect(AuthorizationService.can(null, RESOURCES.SERVICE, ACTIONS.READ)).toBe(false);
      expect(AuthorizationService.can(ROLES.OWNER, null, ACTIONS.READ)).toBe(false);
      expect(AuthorizationService.can(ROLES.OWNER, RESOURCES.SERVICE, null)).toBe(false);
      expect(AuthorizationService.can('ROL_INVENTADO', RESOURCES.SERVICE, ACTIONS.READ)).toBe(false);
      expect(AuthorizationService.can(ROLES.OWNER, 'RECURSO_DESCONOCIDO', ACTIONS.READ)).toBe(false);
      expect(AuthorizationService.can(ROLES.OWNER, RESOURCES.SERVICE, 'ACCION_FANTASMA')).toBe(false);
    });

    test('OWNER: Posee control total sobre el negocio (incluyendo acciones críticas)', () => {
      expect(AuthorizationService.can(ROLES.OWNER, RESOURCES.BUSINESS_PROFILE, ACTIONS.TRANSFER_OWNERSHIP)).toBe(true);
      expect(AuthorizationService.can(ROLES.OWNER, RESOURCES.BUSINESS_PROFILE, ACTIONS.DELETE_BUSINESS)).toBe(true);
      expect(AuthorizationService.can(ROLES.OWNER, RESOURCES.MEMBERSHIP, ACTIONS.MANAGE_MEMBERS)).toBe(true);
      expect(AuthorizationService.can(ROLES.OWNER, RESOURCES.MEMBERSHIP, ACTIONS.CHANGE_ROLE)).toBe(true);
      expect(AuthorizationService.can(ROLES.OWNER, RESOURCES.SERVICE, ACTIONS.PUBLISH_SERVICE)).toBe(true);
      expect(AuthorizationService.can(ROLES.OWNER, RESOURCES.BOOKING, ACTIONS.CONFIRM_BOOKING)).toBe(true);
    });

    test('ADMIN: Posee gestión operativa y de miembros, pero NO puede transferir ni eliminar el negocio', () => {
      // Permitidos
      expect(AuthorizationService.can(ROLES.ADMIN, RESOURCES.MEMBERSHIP, ACTIONS.MANAGE_MEMBERS)).toBe(true);
      expect(AuthorizationService.can(ROLES.ADMIN, RESOURCES.MEMBERSHIP, ACTIONS.CHANGE_ROLE)).toBe(true);
      expect(AuthorizationService.can(ROLES.ADMIN, RESOURCES.SERVICE, ACTIONS.CREATE)).toBe(true);
      expect(AuthorizationService.can(ROLES.ADMIN, RESOURCES.ESTABLISHMENT, ACTIONS.UPDATE)).toBe(true);

      // Prohibidos
      expect(AuthorizationService.can(ROLES.ADMIN, RESOURCES.BUSINESS_PROFILE, ACTIONS.TRANSFER_OWNERSHIP)).toBe(false);
      expect(AuthorizationService.can(ROLES.ADMIN, RESOURCES.BUSINESS_PROFILE, ACTIONS.DELETE_BUSINESS)).toBe(false);
    });

    test('MANAGER: Puede gestionar servicios, reservas y proveedores, pero NO miembros administrativos', () => {
      // Permitidos
      expect(AuthorizationService.can(ROLES.MANAGER, RESOURCES.SERVICE, ACTIONS.CREATE)).toBe(true);
      expect(AuthorizationService.can(ROLES.MANAGER, RESOURCES.SERVICE, ACTIONS.UPDATE)).toBe(true);
      expect(AuthorizationService.can(ROLES.MANAGER, RESOURCES.SERVICE, ACTIONS.PUBLISH_SERVICE)).toBe(true);
      expect(AuthorizationService.can(ROLES.MANAGER, RESOURCES.BOOKING, ACTIONS.CONFIRM_BOOKING)).toBe(true);

      // Prohibidos
      expect(AuthorizationService.can(ROLES.MANAGER, RESOURCES.MEMBERSHIP, ACTIONS.MANAGE_MEMBERS)).toBe(false);
      expect(AuthorizationService.can(ROLES.MANAGER, RESOURCES.MEMBERSHIP, ACTIONS.CHANGE_ROLE)).toBe(false);
      expect(AuthorizationService.can(ROLES.MANAGER, RESOURCES.BUSINESS_PROFILE, ACTIONS.DELETE_BUSINESS)).toBe(false);
      expect(AuthorizationService.can(ROLES.MANAGER, RESOURCES.ESTABLISHMENT, ACTIONS.DELETE)).toBe(false);
    });

    test('MEMBER: Puede operar reservas y ver catálogos, pero NO editar servicios ni gestionar miembros', () => {
      // Permitidos
      expect(AuthorizationService.can(ROLES.MEMBER, RESOURCES.SERVICE, ACTIONS.READ)).toBe(true);
      expect(AuthorizationService.can(ROLES.MEMBER, RESOURCES.BOOKING, ACTIONS.CREATE)).toBe(true);
      expect(AuthorizationService.can(ROLES.MEMBER, RESOURCES.BOOKING, ACTIONS.CONFIRM_BOOKING)).toBe(true);

      // Prohibidos
      expect(AuthorizationService.can(ROLES.MEMBER, RESOURCES.SERVICE, ACTIONS.CREATE)).toBe(false);
      expect(AuthorizationService.can(ROLES.MEMBER, RESOURCES.SERVICE, ACTIONS.UPDATE)).toBe(false);
      expect(AuthorizationService.can(ROLES.MEMBER, RESOURCES.MEMBERSHIP, ACTIONS.MANAGE_MEMBERS)).toBe(false);
      expect(AuthorizationService.can(ROLES.MEMBER, RESOURCES.BUSINESS_PROFILE, ACTIONS.UPDATE)).toBe(false);
    });

    test('VIEWER: Solo lectura (READ) en recursos operativos', () => {
      // Permitidos
      expect(AuthorizationService.can(ROLES.VIEWER, RESOURCES.SERVICE, ACTIONS.READ)).toBe(true);
      expect(AuthorizationService.can(ROLES.VIEWER, RESOURCES.BOOKING, ACTIONS.READ)).toBe(true);
      expect(AuthorizationService.can(ROLES.VIEWER, RESOURCES.CLIENT, ACTIONS.READ)).toBe(true);

      // Prohibidos
      expect(AuthorizationService.can(ROLES.VIEWER, RESOURCES.BOOKING, ACTIONS.CREATE)).toBe(false);
      expect(AuthorizationService.can(ROLES.VIEWER, RESOURCES.SERVICE, ACTIONS.CREATE)).toBe(false);
      expect(AuthorizationService.can(ROLES.VIEWER, RESOURCES.MEMBERSHIP, ACTIONS.READ)).toBe(false);
    });
  });

  describe('2. requirePermission Middleware', () => {
    test('Rechaza con 403 si req.membership o req.user.membershipRole no está establecido', () => {
      const middleware = requirePermission(RESOURCES.SERVICE, ACTIONS.READ);
      const req = {};
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'FORBIDDEN' }));
      expect(next).not.toHaveBeenCalled();
    });

    test('Rechaza con 403 si el rol no tiene el permiso solicitado', () => {
      const middleware = requirePermission(RESOURCES.MEMBERSHIP, ACTIONS.MANAGE_MEMBERS);
      const req = {
        membership: { role: ROLES.MEMBER }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'FORBIDDEN',
        message: expect.stringContaining("El rol 'MEMBER' no tiene permiso para ejecutar la acción 'MANAGE_MEMBERS'")
      }));
      expect(next).not.toHaveBeenCalled();
    });

    test('Permite la ejecución (invoca next()) si el rol tiene el permiso solicitado', () => {
      const middleware = requirePermission(RESOURCES.SERVICE, ACTIONS.CREATE);
      const req = {
        membership: { role: ROLES.MANAGER }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});

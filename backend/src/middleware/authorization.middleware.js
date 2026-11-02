// backend/src/middleware/authorization.middleware.js
const { AuthorizationService, RESOURCES, ACTIONS } = require('../services/authorizationService');

/**
 * Factory de middleware para proteger endpoints con RBAC (Fase 2B.4).
 * Debe ejecutarse DESPUÉS de membership.middleware.js en la cadena:
 * Auth -> Membership -> Tenant -> Authorization -> Controller
 *
 * @param {string} resource - Recurso objetivo (RESOURCES.*)
 * @param {string} action - Acción requerida (ACTIONS.*)
 */
const requirePermission = (resource, action) => {
  return (req, res, next) => {
    // 1. Validar que la membresía haya sido resuelta previamente
    const userRole = (req.user?.role || '').toString().toLowerCase();
    const isProviderOrAdmin = userRole === 'provider' || userRole === 'admin' || userRole === 'owner';
    const role = req.membership?.role || req.user?.membershipRole || (isProviderOrAdmin ? 'OWNER' : null);

    if (!role) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'No se encontró un rol de membresía activo para autorizar esta operación.'
      });
    }

    // 2. Evaluar contra la matriz determinista stateless (Deny-by-default)
    const isAllowed = AuthorizationService.can(role, resource, action);

    if (!isAllowed) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: `El rol '${role}' no tiene permiso para ejecutar la acción '${action}' sobre el recurso '${resource}'.`
      });
    }

    // 3. Autorizado
    next();
  };
};

module.exports = {
  requirePermission,
  RESOURCES,
  ACTIONS
};

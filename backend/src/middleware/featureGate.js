// backend/src/middleware/featureGate.js
const { hasEntitlement } = require('../config/saasEntitlements');

/**
 * Middleware de feature gating: verifica que el tenant tenga la capability requerida.
 * Requiere que saasContext se haya ejecutado antes (req.saas poblado).
 *
 * Uso:
 *   router.get('/analytics', requireEntitlement('ADVANCED_ANALYTICS'), controller);
 *
 * Response 403 incluye: { error, required, currentPlan, upgradeUrl }
 */
function requireEntitlement(capability) {
  return (req, res, next) => {
    if (!req.saas) {
      return res.status(401).json({ 
        error: 'Contexto SaaS requerido',
        message: 'Autentíquese y seleccione un negocio activo.'
      });
    }

    if (!hasEntitlement(req.saas.plan, capability)) {
      return res.status(403).json({ 
        error: 'Plan no incluye esta función',
        required: capability,
        currentPlan: req.saas.plan,
        upgradeUrl: '/api/saas/checkout'
      });
    }

    next();
  };
}

/**
 * Middleware que requiere rol mínimo en el membership (OWNER > ADMIN > MANAGER > MEMBER > VIEWER)
 * Uso: router.delete('/team/:id', requireRole('ADMIN'), controller);
 */
const ROLE_HIERARCHY = {
  OWNER: 5,
  ADMIN: 4,
  MANAGER: 3,
  MEMBER: 2,
  VIEWER: 1
};

function requireRole(minRole) {
  const minLevel = ROLE_HIERARCHY[minRole] ?? 0;
  return (req, res, next) => {
    if (!req.saas) {
      return res.status(401).json({ error: 'Contexto SaaS requerido' });
    }
    const userLevel = ROLE_HIERARCHY[req.saas.role] ?? 0;
    if (userLevel < minLevel) {
      return res.status(403).json({ 
        error: 'Rol insuficiente',
        required: minRole,
        currentRole: req.saas.role
      });
    }
    next();
  };
}

/**
 * Middleware que requiere que el usuario sea OWNER del negocio
 */
function requireOwner(req, res, next) {
  if (!req.saas) {
    return res.status(401).json({ error: 'Contexto SaaS requerido' });
  }
  if (req.saas.role !== 'OWNER') {
    return res.status(403).json({ 
      error: 'Solo el propietario puede realizar esta acción',
      currentRole: req.saas.role
    });
  }
  next();
}

module.exports = {
  requireEntitlement,
  requireRole,
  requireOwner
};
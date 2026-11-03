/**
 * Middleware para la restricción de rutas basada en roles de usuario.
 */

function toApiRole(roleStr) {
  if (!roleStr) return 'client';
  const norm = String(roleStr).trim().toLowerCase();
  if (norm === 'admin') return 'admin';
  if (norm === 'salon') return 'salon';
  if (norm === 'provider' || norm === 'prestador') return 'provider';
  if (norm === 'client' || norm === 'cliente') return 'client';
  return norm;
}

/**
 * Portero de autorización por roles.
 *
 * @param {...string} allowedRoles - Roles permitidos ('admin', 'client', 'provider', 'salon')
 * @returns {Function} Express middleware
 */
function requireRol(...allowedRoles) {
  const normalizedAllowed = allowedRoles.map(toApiRole);

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Autenticación requerida'
      });
    }

    const userRole = toApiRole(req.user.role || req.user.rol);
    if (!normalizedAllowed.includes(userRole)) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'No tiene permisos suficientes para acceder a este recurso'
      });
    }

    next();
  };
}

module.exports = {
  requireRol,
  toApiRole
};

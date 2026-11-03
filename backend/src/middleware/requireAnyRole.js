// backend/src/middleware/requireAnyRole.js
/**
 * Middleware para autorización flexible por roles.
 * Permite especificar múltiples roles permitidos; pasa si el usuario tiene ALGUNO.
 *
 * Diferencias con requireRol (roles.js):
 * - Nomenclatura más explícita: "requireAnyRole" = OR lógico entre roles
 * - Soporta tanto `req.user.role` (API role) como `req.user.rol` (DB role) y `req.user.roles[]` (JWT array)
 * - Incluye logging de auditoría para trazabilidad
 * - Valida X-App-Audience header si se especifica
 */

const { getJwtSecret } = require('../config/jwt');

/**
 * Normaliza un rol a formato API estándar
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
 * Extrae los roles del usuario desde múltiples fuentes (prioridad descendente):
 * 1. req.user.roles[] (array en JWT - NUEVO en Fase 6)
 * 2. req.user.role (rol API simple)
 * 3. req.user.rol (rol DB original)
 */
function extractUserRoles(user) {
  if (!user) return [];

  // 1. Nuevo: array de roles en JWT (roles[])
  if (Array.isArray(user.roles) && user.roles.length > 0) {
    return user.roles.map(toApiRole).filter(Boolean);
  }

  // 2. Rol simple API
  if (user.role) {
    return [toApiRole(user.role)];
  }

  // 3. Rol DB original
  if (user.rol) {
    return [toApiRole(user.rol)];
  }

  return ['client']; // fallback por defecto
}

/**
 * Middleware principal: requireAnyRole
 *
 * @param {...string} allowedRoles - Roles permitidos en formato API ('admin', 'client', 'provider', 'salon')
 * @param {Object} options - Opciones adicionales
 * @param {string|string[]} options.audience - Valor(es) esperados de X-App-Audience ('client', 'provider', 'salon', 'admin')
 * @param {boolean} options.requireAudience - Si true, rechaza peticiones sin header X-App-Audience (default: false)
 * @returns {Function} Express middleware
 */
function requireAnyRole(...args) {
  // Separar roles de opciones: últimos args pueden ser objeto options
  const options = (args.length > 0 && typeof args[args.length - 1] === 'object' && !Array.isArray(args[args.length - 1]))
    ? args.pop()
    : {};
  const allowedRoles = args.map(toApiRole).filter(Boolean);

  if (allowedRoles.length === 0) {
    throw new Error('requireAnyRole: se requiere al menos un rol permitido');
  }

  const { audience, requireAudience = false } = options;
  const allowedAudiences = audience ? (Array.isArray(audience) ? audience : [audience]) : null;

  return async (req, res, next) => {
    const startTime = Date.now();

    // 1. Autenticación requerida
    if (!req.user) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Autenticación requerida'
      });
    }

    // 2. Validación X-App-Audience (si se especifica)
      if (allowedAudiences) {
        const appAudience = req.header('X-App-Audience')?.toLowerCase().trim();
        if (!appAudience) {
          if (requireAudience) {
            return res.status(400).json({
              error: 'BAD_REQUEST',
              message: 'Header X-App-Audience requerido',
              expected: allowedAudiences
            });
          }
          // Si no es requerido, solo log warning
          console.warn(`⚠️ [requireAnyRole] Petición sin X-App-Audience (permitido por config)`);
        } else if (!allowedAudiences.includes(appAudience)) {
          return res.status(403).json({
            error: 'FORBIDDEN',
            message: `Audiencia '${appAudience}' no autorizada para este endpoint`,
            allowed: allowedAudiences
          });
        }

        // 🔒 NUEVO: Validar JWT audience claim vs header X-App-Audience
        // El JWT debe contener claim 'audience' que coincida con el header
        if (req.user && req.user.audience) {
          const jwtAudience = String(req.user.audience).toLowerCase().trim();
          if (jwtAudience !== appAudience) {
            console.warn(`🚫 [requireAnyRole] JWT audience mismatch`, {
              userId: req.user.id,
              jwtAudience,
              headerAudience: appAudience,
              path: req.path,
              method: req.method,
              ip: req.ip
            });
            return res.status(403).json({
              error: 'FORBIDDEN',
              message: `JWT audience claim ('${jwtAudience}') no coincide con header X-App-Audience ('${appAudience}')`
            });
          }
        }
      }

    // 3. Verificación de roles (OR lógico)
    const userRoles = extractUserRoles(req.user);
    
    // Admin bypass: el rol admin tiene acceso a todo
    const isAdmin = userRoles.includes('admin');
    // Salon se trata como provider para propósitos de autorización
    const normalizedUserRoles = userRoles.map(r => r === 'salon' ? 'provider' : r);
    const hasAllowedRole = isAdmin || normalizedUserRoles.some(r => allowedRoles.includes(r));

    if (!hasAllowedRole) {
      // Log de auditoría para acceso denegado
      console.warn(`🚫 [requireAnyRole] Acceso denegado`, {
        userId: req.user.id,
        userRoles,
        allowedRoles,
        audience: req.header('X-App-Audience'),
        path: req.path,
        method: req.method,
        ip: req.ip
      });

      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'No tiene permisos suficientes para acceder a este recurso',
        required: allowedRoles,
        current: userRoles
      });
    }

    // 4. Éxito - adjuntar metadatos de autorización para uso downstream
    const matchedRole = isAdmin ? 'admin' : normalizedUserRoles.find(r => allowedRoles.includes(r)) || userRoles[0];
    req.authContext = {
      allowedRoles,
      matchedRole,
      userRoles,
      audience: req.header('X-App-Audience'),
      authorizedAt: new Date().toISOString()
    };

    // Log de éxito (solo en dev/staging para no saturar logs)
    if (process.env.NODE_ENV !== 'production') {
      console.log(`✅ [requireAnyRole] Autorizado`, {
        userId: req.user.id,
        matchedRole: req.authContext.matchedRole,
        audience: req.authContext.audience,
        path: req.path,
        latencyMs: Date.now() - startTime
      });
    }

    next();
  };
}

/**
 * Variante estricta: requiere X-App-Audience obligatorio
 */
function requireAnyRoleWithAudience(...allowedRoles) {
  return requireAnyRole(...allowedRoles, { requireAudience: true });
}

/**
 * Helper: middleware para endpoints solo de app cliente (glow_client)
 */
const clientOnly = requireAnyRole('client', 'admin', { audience: 'client' });

/**
 * Helper: middleware para endpoints solo de app prestador (glow_provider)
 */
const providerOnly = requireAnyRole('provider', 'salon', 'admin', { audience: 'provider' });

/**
 * Helper: middleware para endpoints de salón
 */
const salonOnly = requireAnyRole('salon', 'admin', { audience: ['provider', 'salon'] });

module.exports = {
  requireAnyRole,
  requireAnyRoleWithAudience,
  clientOnly,
  providerOnly,
  salonOnly,
  toApiRole,
  extractUserRoles
};
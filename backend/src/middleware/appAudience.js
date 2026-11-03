// backend/src/middleware/appAudience.js
/**
 * Middleware de validación X-App-Audience (Fase 6).
 * 
 * Diferencia entre:
 * - glow_client (app cliente final): audience = 'client'
 * - glow_provider (app prestador/salón): audience = 'provider'
 * - salon (app salón - futuro): audience = 'salon'
 * - admin (dashboard admin): audience = 'admin'
 *
 * Este middleware:
 * 1. Valida que el header X-App-Audience esté presente y sea válido
 * 2. Verifica coherencia entre audience y rol del usuario (opcional)
 * 3. Adjunta metadata de audiencia a req.appAudience
 */

const VALID_AUDIENCES = ['client', 'provider', 'salon', 'admin'];

/**
 * Callbacks máquina-a-máquina exentos de `X-App-Audience`.
 *
 * Wompi no envía esa cabecera: su POST llegaba con 400 y el handler nunca veía el
 * evento, así que ningún pago se cerró nunca (webhook_events vacío). La
 * autenticación de estas rutas es la firma del evento (checksum con
 * WOMPI_EVENTS_SECRET), que cada handler verifica antes de tocar nada y falla
 * cerrado con 401.
 *
 * Se comparan rutas EXACTAS (sin sufijo comodín): una subruta arbitraria bajo el
 * mismo prefijo sigue exigiendo la cabecera.
 */
const MACHINE_CALLBACK_PATHS = new Set([
  '/payments/store-webhook',
  '/payments/wompi-webhook',
]);

function isMachineCallback(req) {
  const original = (req && (req.originalUrl || req.url)) || '';
  const sinQuery = original.split('?')[0];
  // El middleware se monta en /api; se acepta también la ruta sin ese prefijo.
  const relativa = sinQuery.replace(/^\/api(?=\/)/, '');
  return MACHINE_CALLBACK_PATHS.has(sinQuery) || MACHINE_CALLBACK_PATHS.has(relativa);
}


function normalizeAudience(audience) {
  if (!audience) return null;
  const norm = String(audience).trim().toLowerCase();
  return VALID_AUDIENCES.includes(norm) ? norm : null;
}

/**
 * Middleware que valida X-App-Audience header
 * 
 * @param {Object} options
 * @param {string|string[]} options.allowed - Audiencia(s) permitida(s) para este endpoint
 * @param {boolean} options.required - Si true, rechaza peticiones sin header (default: true)
 * @param {boolean} options.enforceRoleConsistency - Si true, verifica coherencia audience↔rol (default: false)
 * @returns {Function} Express middleware
 */
function validateAppAudience(options = {}) {
  const { allowed = VALID_AUDIENCES, required = true, enforceRoleConsistency = false } = options;
  const allowedAudiences = Array.isArray(allowed) ? allowed.map(normalizeAudience).filter(Boolean) : [normalizeAudience(allowed)].filter(Boolean);

  if (allowedAudiences.length === 0) {
    throw new Error('validateAppAudience: se requiere al menos una audiencia válida');
  }

  return (req, res, next) => {
    // 0. Callbacks máquina-a-máquina (pasarelas): su autenticación es la firma.
    if (isMachineCallback(req)) {
      req.appAudience = null;
      return next();
    }

    const rawAudience = req.header('X-App-Audience');
    const audience = normalizeAudience(rawAudience);

    // 1. Header requerido
    if (!audience) {
      if (required) {
        return res.status(400).json({
          error: 'BAD_REQUEST',
          message: 'Header X-App-Audience requerido',
          expected: allowedAudiences,
          validValues: VALID_AUDIENCES
        });
      }
      // Si no es requerido, continuar sin audience
      req.appAudience = null;
      return next();
    }

    // 2. Audiencia permitida para este endpoint
    if (!allowedAudiences.includes(audience)) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: `Audiencia '${audience}' no autorizada para este endpoint`,
        allowed: allowedAudiences,
        validValues: VALID_AUDIENCES
      });
    }

    // 3. Verificación de coherencia audience ↔ rol (opcional)
    if (enforceRoleConsistency && req.user) {
      const userRoles = Array.isArray(req.user.roles) ? req.user.roles : [req.user.role].filter(Boolean);
      const userApiRoles = userRoles.map(r => String(r).toLowerCase().trim());

      // Mapeo de audiencia esperada por rol
      const audienceForRole = {
        client: 'client',
        provider: 'provider',
        salon: 'provider', // salón usa app de prestador
        admin: 'admin',
        owner: 'provider',
        manager: 'provider',
        staff: 'provider'
      };

      const expectedAudience = userApiRoles.map(r => audienceForRole[r]).filter(Boolean);
      const hasConsistency = expectedAudience.length === 0 || expectedAudience.some(a => a === audience);

      if (!hasConsistency) {
        console.warn(`⚠️ [appAudience] Incoherencia audience↔rol`, {
          userId: req.user.id,
          audience,
          userRoles: userApiRoles,
          expectedAudience,
          path: req.path
        });
        // No bloqueamos, solo advertimos (configurable en futuro)
      }
    }

    // 4. Adjuntar metadata
    req.appAudience = audience;
    req.appAudienceRaw = rawAudience;

    next();
  };
}

/**
 * Helpers preconfigurados para endpoints típicos
 */

// Solo app cliente (glow_client)
const clientAppOnly = validateAppAudience({ allowed: 'client' });

// Solo app prestador/salón (glow_provider)
const providerAppOnly = validateAppAudience({ allowed: 'provider' });

// App cliente O admin
const clientOrAdminApp = validateAppAudience({ allowed: ['client', 'admin'] });

// App prestador O admin
const providerOrAdminApp = validateAppAudience({ allowed: ['provider', 'admin'] });

// Cualquier app válida (solo valida formato)
const anyValidApp = validateAppAudience({ allowed: VALID_AUDIENCES });

/**
 * Middleware combinado: requireAnyRole + validateAppAudience
 * Uso: requireRoleAndAudience('provider', 'admin', { audience: 'provider' })
 */
const { requireAnyRole } = require('./requireAnyRole');

function requireRoleAndAudience(...args) {
  // args: roles... + options
  const options = (args.length > 0 && typeof args[args.length - 1] === 'object' && !Array.isArray(args[args.length - 1]))
    ? args.pop()
    : {};
  const allowedRoles = args;

  // Extraer audience de options para validateAppAudience
  const { audience, requireAudience, ...roleOptions } = options;

  const roleMiddleware = requireAnyRole(...allowedRoles, roleOptions);
  const audienceMiddleware = audience ? validateAppAudience({ allowed: audience, required: requireAudience !== false }) : (req, res, next) => next();

  return (req, res, next) => {
    // Ejecutar en secuencia: primero audience, luego roles
    audienceMiddleware(req, res, (err) => {
      if (err) return next(err);
      roleMiddleware(req, res, next);
    });
  };
}

module.exports = {
  validateAppAudience,
  clientAppOnly,
  providerAppOnly,
  clientOrAdminApp,
  providerOrAdminApp,
  anyValidApp,
  requireRoleAndAudience,
  VALID_AUDIENCES,
  normalizeAudience
};
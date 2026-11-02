// backend/src/middleware/superAdminGuard.js
const { pool } = require('../config/db');

/**
 * Middleware que verifica si el usuario es SUPER_ADMIN de la plataforma.
 * SUPER_ADMIN tiene acceso cross-tenant a métricas de plataforma, gestión de tenants, etc.
 *
 * Opciones de configuración (via env):
 * - SUPER_ADMIN_EMAILS: lista de emails separados por coma (ej: "admin@glowapp.com,ceo@glowapp.com")
 * - SUPER_ADMIN_USER_IDS: lista de IDs de usuario separados por coma
 * - SUPER_ADMIN_ROLE: si existe un rol 'SUPER_ADMIN' en usuarios.rol (requiere migración)
 *
 * Por defecto usa SUPER_ADMIN_EMAILS para no requerir cambios en BD.
 */
function getSuperAdminEmails() {
  const raw = process.env.SUPER_ADMIN_EMAILS || '';
  return new Set(raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean));
}

function getSuperAdminUserIds() {
  const raw = process.env.SUPER_ADMIN_USER_IDS || '';
  return new Set(raw.split(',').map(id => parseInt(id.trim(), 10)).filter(Boolean));
}

const SUPER_ADMIN_ROLE_ENABLED = process.env.SUPER_ADMIN_ROLE_ENABLED === 'true';

/**
 * Verifica si un usuario (req.user) es super-admin
 */
async function isSuperAdmin(user) {
  if (!user?.id) return false;

  // 1. Por email (configuración inmediata sin tocar BD)
  const superEmails = getSuperAdminEmails();
  if (superEmails.size > 0 && user.email && superEmails.has(user.email.toLowerCase())) {
    return true;
  }

  // 2. Por user ID
  const superIds = getSuperAdminUserIds();
  if (superIds.size > 0 && superIds.has(user.id)) {
    return true;
  }

  // 3. Por rol en BD (opcional, requiere migración agregar rol SUPER_ADMIN)
  if (SUPER_ADMIN_ROLE_ENABLED && user.rol === 'SUPER_ADMIN') {
    return true;
  }

  return false;
}

/**
 * Middleware Express: bloquea si no es super-admin
 */
module.exports = async function superAdminGuard(req, res, next) {
  if (!req.user?.id) {
    return res.status(401).json({ error: 'Autenticación requerida' });
  }

  const superAdmin = await isSuperAdmin(req.user);

  if (!superAdmin) {
    return res.status(403).json({ 
      error: 'Acceso denegado: se requieren privilegios de super-administrador de plataforma' 
    });
  }

  // Marcar en request para uso posterior
  req.isSuperAdmin = true;
  next();
};

/**
 * Helper para usar en controllers/services sin middleware
 */
module.exports.isSuperAdmin = isSuperAdmin;
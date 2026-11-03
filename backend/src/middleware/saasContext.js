// backend/src/middleware/saasContext.js
const { pool } = require('../config/db');
const { hasEntitlement, SAAS_CAPABILITIES } = require('../config/saasEntitlements');

/**
 * Middleware SaaS B2B: resuelve el business_profile activo del usuario autenticado
 * y popula req.saas con { tenantId, name, plan, role, membershipId, capabilities[] }.
 *
 * DIFERENCIA con tenantContext.js (RLS):
 * - tenantContext.js: fija app.tenant_id en conexión PG para RLS (row-level security)
 * - saasContext.js: lógica de negocio SaaS (planes, features, billing, límites)
 *
 * Se ejecuta DESPUÉS de authMiddleware (req.user disponible).
 * Fail-open: si hay error, req.saas = null y continúa (no rompe rutas existentes).
 */
module.exports = async function saasContext(req, res, next) {
  // Sin usuario autenticado → rutas públicas, sin contexto SaaS
  if (!req.user?.id) {
    req.saas = null;
    return next();
  }

  try {
    // Buscar membership ACTIVA del usuario (la más reciente aceptada)
    const { rows } = await pool.query(`
      SELECT m.*, bp.saas_plan, bp.id as business_profile_id, bp.name as business_name
      FROM memberships m
      JOIN business_profiles bp ON bp.id = m.business_profile_id
      WHERE m.user_id = $1 AND m.status = 'ACTIVE'
      ORDER BY m.accepted_at DESC NULLS LAST
      LIMIT 1
    `, [req.user.id]);

    if (rows.length === 0) {
      // Usuario autenticado pero sin membership activa en ningún negocio
      req.saas = null;
      return next();
    }

    const m = rows[0];
    const plan = m.saas_plan || 'FREE_TRIAL';

    // Calcular capacidades según plan (usa motor existente saasEntitlements.js)
    const capabilities = Object.keys(SAAS_CAPABILITIES)
      .filter(cap => hasEntitlement(plan, cap));

    req.saas = {
      tenantId: m.business_profile_id,
      name: m.business_name,
      plan,
      role: m.role, // OWNER, ADMIN, MANAGER, MEMBER, VIEWER
      membershipId: m.id,
      capabilities
    };

    next();
  } catch (err) {
    console.error('[saasContext] Error resolviendo contexto SaaS:', err.message);
    // Fail-open: no bloquear request por error de contexto SaaS
    req.saas = null;
    next();
  }
};
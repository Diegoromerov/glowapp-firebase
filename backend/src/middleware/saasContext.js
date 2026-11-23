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
 * Fail-closed: si hay error de base de datos, la ruta no continúa sin autorización.
 */
module.exports = async function saasContext(req, res, next) {
  // Sin usuario autenticado → rutas públicas, sin contexto SaaS
  if (!req.user?.id) {
    req.saas = null;
    return next();
  }

  try {
    // Si la app envía una sede activa, resolver su tenant solo a través de una
    // membership activa del usuario. Nunca se confía en el header como permiso.
    const activeSalonHeader = req.headers?.['x-active-salon-id'] || req.headers?.['x-salon-id'];
    let activeSalonId = null;
    if (activeSalonHeader !== undefined && activeSalonHeader !== null && activeSalonHeader !== '') {
      const normalized = String(activeSalonHeader).trim();
      if (!/^\d+$/.test(normalized) || !Number.isSafeInteger(Number(normalized)) || Number(normalized) < 1) {
        return res.status(400).json({ error: 'x-active-salon-id debe ser un identificador numérico válido.' });
      }
      activeSalonId = Number(normalized);
    }

    // En ausencia de selección se conserva el contexto histórico más reciente.
    const { rows } = await pool.query(`
      SELECT m.*, bp.saas_plan, bp.id as business_profile_id, bp.name as business_name,
             s.id AS active_salon_id
      FROM memberships m
      JOIN business_profiles bp ON bp.id = m.business_profile_id
      LEFT JOIN salones s ON s.business_profile_id = bp.id
      WHERE m.user_id = $1 AND m.status = 'ACTIVE'
        AND ($2::integer IS NULL OR s.id = $2)
      ORDER BY m.accepted_at DESC NULLS LAST, s.id ASC
      LIMIT 1
    `, [req.user.id, activeSalonId]);

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
      salonId: m.active_salon_id || activeSalonId,
      name: m.business_name,
      plan,
      role: m.role, // OWNER, ADMIN, MANAGER, MEMBER, VIEWER
      membershipId: m.id,
      capabilities
    };

    next();
  } catch (err) {
    console.error('[saasContext] Error resolviendo contexto SaaS:', err.message);
    req.saas = null;
    return res.status(503).json({
      error: 'No se pudo comprobar la membresía activa.',
      code: 'SAAS_CONTEXT_UNAVAILABLE'
    });
  }
};

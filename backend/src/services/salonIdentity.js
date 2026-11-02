// backend/src/services/salonIdentity.js
/**
 * E-02a (D-GL-027) — identidad canónica de un salón.
 *
 * Un salón vive en dos modelos: `salones` (SaaS clásico, con `salon_miembros`)
 * y `business_profiles` + `memberships` (modelo canónico de la migración 082,
 * que es de donde `saasContext` y el RBAC leen `req.saas`).
 *
 * `/api/saas/bootstrap` creaba el perfil sólo cuando alguien lo llamaba a mano,
 * así que un salón recién creado no tenía membership: el usuario entraba al
 * panel y todas las rutas SaaS respondían 401 "Contexto SaaS requerido".
 *
 * Este módulo cierra ese hueco en el único punto donde el salón nace
 * (`salonController.createSalon`). Es idempotente: repetirlo no duplica ni
 * degrada un rol ya asignado.
 *
 * Convención de id, la misma que usa `saasBootstrapRoutes`:
 *   business_profiles.id      = 'salon-<salonId>'
 *   business_profiles.tenant_id = 'tenant-<salonId>'
 */

const crypto = require('crypto');

const PLANES_VALIDOS = ['FREE_TRIAL', 'FREEMIUM', 'BASIC', 'PRO', 'ENTERPRISE'];

/** `business_profiles.id` para un salón. La columna es VARCHAR(36). */
const profileIdForSalon = (salonId) => `salon-${salonId}`.slice(0, 36);

/** `business_profiles.tenant_id` para un salón. La columna es VARCHAR(64). */
const tenantIdForSalon = (salonId) => `tenant-${salonId}`.slice(0, 64);

/**
 * Vertical de negocio: preferencia por belleza, si no la primera disponible.
 * Devuelve null si `business_verticals` está vacía (el perfil no se puede crear
 * porque `vertical_id` es NOT NULL).
 */
async function resolveVerticalId(db) {
  const { rows } = await db.query(
    `SELECT id FROM business_verticals
     ORDER BY (CASE WHEN code ILIKE '%BELLEZA%' OR code ILIKE '%BELL%' THEN 0 ELSE 1 END), name ASC
     LIMIT 1`
  );
  return rows.length > 0 ? rows[0].id : null;
}

/**
 * Garantiza el `business_profile` del salón y la membership OWNER de su dueño.
 *
 * @param {{ query: Function }} db cliente con `query` (pool o cliente de transacción)
 * @param {{ salonId: number|string, ownerUserId: number, name?: string, plan?: string }} datos
 * @returns {Promise<{provisioned: boolean, profileId?: string, tenantId?: string, reason?: string}>}
 */
async function ensureSalonOwnerIdentity(db, { salonId, ownerUserId, name, plan = 'FREE_TRIAL' }) {
  if (!salonId || !ownerUserId) {
    throw new Error('salonId y ownerUserId son obligatorios para provisionar la identidad del salón');
  }

  const verticalId = await resolveVerticalId(db);
  if (!verticalId) {
    return { provisioned: false, reason: 'NO_VERTICAL' };
  }

  const profileId = profileIdForSalon(salonId);
  const tenantId = tenantIdForSalon(salonId);
  const nombre = String(name || '').trim().slice(0, 150) || `Salón ${salonId}`;
  const planNormalizado = String(plan || 'FREE_TRIAL').toUpperCase();
  const planFinal = PLANES_VALIDOS.includes(planNormalizado) ? planNormalizado : 'FREE_TRIAL';

  await db.query(
    `INSERT INTO business_profiles
       (id, provider_id, vertical_id, name, onboarding_mode, lifecycle_stage,
        compliance_score, city, country, tenant_id, saas_plan)
     VALUES ($1, $2, $3, $4, 'EXISTING_BUSINESS', 'OPERATION', 45.00, 'Bogotá', 'Colombia', $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       saas_plan = COALESCE(business_profiles.saas_plan, EXCLUDED.saas_plan),
       tenant_id = COALESCE(NULLIF(business_profiles.tenant_id, 'default'), EXCLUDED.tenant_id),
       updated_at = CURRENT_TIMESTAMP`,
    [profileId, ownerUserId, verticalId, nombre, tenantId, planFinal]
  );

  await db.query(
    `INSERT INTO memberships
       (id, user_id, business_profile_id, role, status, accepted_at, created_by_user_id)
     VALUES ($1, $2, $3, 'OWNER', 'ACTIVE', CURRENT_TIMESTAMP, $2)
     ON CONFLICT (user_id, business_profile_id) DO UPDATE SET
       role = 'OWNER',
       status = 'ACTIVE',
       accepted_at = COALESCE(memberships.accepted_at, CURRENT_TIMESTAMP),
       updated_at = CURRENT_TIMESTAMP`,
    [crypto.randomUUID(), ownerUserId, profileId]
  );

  return { provisioned: true, profileId, tenantId };
}

module.exports = {
  ensureSalonOwnerIdentity,
  resolveVerticalId,
  profileIdForSalon,
  tenantIdForSalon,
  PLANES_VALIDOS,
};

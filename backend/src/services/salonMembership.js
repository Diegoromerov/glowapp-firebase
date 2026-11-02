// backend/src/services/salonMembership.js
/**
 * E-02b (D-GL-027) — lectura canónica de los miembros de un salón.
 *
 * Hasta ahora el equipo se leía de `salon_miembros` (sub_rol como texto libre,
 * sin CHECK) y la capa SaaS —RBAC, entitlements, `req.saas`— de `memberships`.
 * Dos fuentes para la misma persona: el rol que autoriza y el que se muestra
 * podían discrepar sin que nada lo notara.
 *
 * Este módulo es el único punto que traduce entre los dos vocabularios:
 *
 *   OWNER   <-> DUEÑO          (autoriza todo)
 *   ADMIN   <-> ADMINISTRADOR
 *   MANAGER <-> RECEPCIONISTA  (R-1: Recepcionista es MANAGER, no un rol nuevo)
 *   MEMBER  <-> PRESTADOR_INDEPENDIENTE | EMPLEADO
 *   VIEWER  <-> EMPLEADO
 *
 * `memberships.role` manda para autorizar; `memberships.sub_rol` (migración 114)
 * conserva la etiqueta que el cliente Flutter muestra y edita.
 *
 * Convención de perfil: `business_profiles.id = 'salon-<salonId>'`, la misma que
 * usan `saasBootstrapRoutes`, `salonIdentity` y la migración 113.
 */

/** sub_rol heredado → rol canónico. */
const SUB_ROL_TO_ROLE = Object.freeze({
  'DUEÑO': 'OWNER',
  'DUENO': 'OWNER',
  'OWNER': 'OWNER',
  'ADMINISTRADOR': 'ADMIN',
  'ADMIN': 'ADMIN',
  'RECEPCIONISTA': 'MANAGER',
  'MANAGER': 'MANAGER',
  'PRESTADOR_INDEPENDIENTE': 'MEMBER',
  'EMPLEADO': 'MEMBER',
  'MEMBER': 'MEMBER',
  'VIEWER': 'VIEWER',
});

/** Rol canónico → sub_rol por defecto (cuando no hay etiqueta guardada). */
const ROLE_TO_SUB_ROL = Object.freeze({
  OWNER: 'DUEÑO',
  ADMIN: 'ADMINISTRADOR',
  MANAGER: 'RECEPCIONISTA',
  MEMBER: 'EMPLEADO',
  VIEWER: 'EMPLEADO',
});

/** Los roles que pueden administrar el equipo de un salón. */
const ROLES_ADMIN = Object.freeze(['OWNER', 'ADMIN']);

const profileIdForSalon = (salonId) => `salon-${salonId}`.slice(0, 36);

/** Normaliza un sub_rol libre al rol canónico. Desconocido → MEMBER. */
function roleForSubRol(subRol) {
  const clave = String(subRol || '').trim().toUpperCase();
  return SUB_ROL_TO_ROLE[clave] || 'MEMBER';
}

/** Etiqueta por defecto para un rol canónico. */
function subRolForRole(role) {
  return ROLE_TO_SUB_ROL[String(role || '').toUpperCase()] || 'EMPLEADO';
}

/**
 * Miembros del salón, con la forma que ya consume el cliente Flutter
 * (`id, user_id, nombre, email, phone, sub_rol, estatus, creado_at`).
 */
async function listSalonMembers(db, salonId) {
  const { rows } = await db.query(
    `SELECT m.id,
            m.user_id,
            u.nombre,
            u.email,
            u.phone,
            COALESCE(NULLIF(m.sub_rol, ''), m.role) AS sub_rol,
            m.role,
            CASE WHEN m.status = 'ACTIVE' THEN 'ACTIVO' ELSE 'INACTIVO' END AS estatus,
            m.created_at AS creado_at
       FROM memberships m
       JOIN usuarios u ON u.id = m.user_id
      WHERE m.business_profile_id = $1
      ORDER BY m.created_at ASC`,
    [profileIdForSalon(salonId)]
  );

  // La etiqueta guardada puede venir nula en filas viejas: se deriva del rol.
  return rows.map((r) => ({
    ...r,
    sub_rol: r.sub_rol && SUB_ROL_TO_ROLE[String(r.sub_rol).toUpperCase()]
      ? String(r.sub_rol).toUpperCase()
      : subRolForRole(r.role),
  }));
}

/**
 * Rol activo del usuario en el salón.
 * @returns {Promise<{role: string, sub_rol: string}|null>}
 */
async function getMemberRole(db, salonId, userId) {
  const { rows } = await db.query(
    `SELECT role, sub_rol
       FROM memberships
      WHERE business_profile_id = $1 AND user_id = $2 AND status = 'ACTIVE'`,
    [profileIdForSalon(salonId), userId]
  );
  if (rows.length === 0) return null;
  const role = String(rows[0].role || '').toUpperCase();
  const subRol = rows[0].sub_rol
    ? String(rows[0].sub_rol).toUpperCase()
    : subRolForRole(role);
  return { role, sub_rol: subRol };
}

/** ¿El usuario puede administrar el equipo de este salón? */
async function canAdminSalon(db, salonId, userId) {
  const m = await getMemberRole(db, salonId, userId);
  return !!m && ROLES_ADMIN.includes(m.role);
}

/**
 * Crea o actualiza la membership del usuario en el salón. Idempotente.
 * Es el punto de sincronización tras una escritura en `salon_miembros`, para
 * que la lectura canónica y el flujo de invitación no se separen.
 *
 * @param {{query: Function}} db
 * @param {{salonId: any, userId: any, subRol: string, status?: 'ACTIVE'|'SUSPENDED'|'REVOKED', createdBy?: any}} datos
 */
async function ensureMembership(db, { salonId, userId, subRol, status = 'ACTIVE', createdBy = null }) {
  const role = roleForSubRol(subRol);
  const etiqueta = String(subRol || '').trim().toUpperCase() || subRolForRole(role);

  const { rows } = await db.query(
    `INSERT INTO memberships
       (id, user_id, business_profile_id, role, sub_rol, status, invited_at, accepted_at, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP,
             CASE WHEN $6 = 'ACTIVE' THEN CURRENT_TIMESTAMP ELSE NULL END, $7)
     ON CONFLICT (user_id, business_profile_id) DO UPDATE SET
       role = EXCLUDED.role,
       sub_rol = EXCLUDED.sub_rol,
       status = EXCLUDED.status,
       accepted_at = COALESCE(memberships.accepted_at, EXCLUDED.accepted_at),
       updated_at = CURRENT_TIMESTAMP
     RETURNING id, role, sub_rol, status`,
    [require('crypto').randomUUID(), userId, profileIdForSalon(salonId), role, etiqueta, status, createdBy]
  );
  return rows[0];
}

module.exports = {
  SUB_ROL_TO_ROLE,
  ROLE_TO_SUB_ROL,
  ROLES_ADMIN,
  profileIdForSalon,
  roleForSubRol,
  subRolForRole,
  listSalonMembers,
  getMemberRole,
  canAdminSalon,
  ensureMembership,
};

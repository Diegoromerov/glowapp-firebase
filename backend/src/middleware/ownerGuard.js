// backend/src/middleware/ownerGuard.js
//
// Guardas de autorización por salón (multi-sede).
//
// Motivo: la pertenencia y el sub_rol se verificaban con condicionales `if`
// duplicados dentro de cada controlador (salonController.js:159-166, :204-215).
// Eso permite que un endpoint nuevo olvide el chequeo. Este middleware lo
// centraliza y falla cerrado.
//
// Reglas de diseño (no negociables):
//  1. El salon_id NUNCA se toma como verdad desde el cliente: se valida forma
//     y luego se confirma contra salon_miembros para el usuario autenticado.
//  2. Ante error de base de datos NO se llama a next(): se falla cerrado.
//  3. El sub_rol se lee de la base, no de req.user.role. `req.user.role` viene
//     de toApiRole() (config/jwt.js) y es un mapeo para la API, no el sub_rol
//     del salón.

const { pool } = require('../config/db');
const { runInTenantTransaction } = require('../config/tenantRouting');

// Sub-roles válidos en salon_miembros (alineados con salonController.inviteMember)
const SUB_ROLES = Object.freeze({
  DUENO: 'DUEÑO',
  ADMINISTRADOR: 'ADMINISTRADOR',
  PRESTADOR_INDEPENDIENTE: 'PRESTADOR_INDEPENDIENTE',
  EMPLEADO: 'EMPLEADO',
  RECEPCIONISTA: 'RECEPCIONISTA',
});

const ESTATUS_ACTIVO = 'ACTIVO';

/**
 * Extrae el salon_id de la petición y lo valida como entero positivo.
 * Orden de precedencia: params.salonId -> body.salon_id -> body.salonId
 *                       -> query.salon_id -> query.salonId
 *                       -> headers['x-active-salon-id'] -> headers['x-salon-id']
 * @returns {number|null} entero positivo, o null si no es resoluble/válido.
 */
function resolveSalonId(req) {
  const raw =
    req.params?.salonId ??
    req.body?.salon_id ??
    req.body?.salonId ??
    req.query?.salon_id ??
    req.query?.salonId ??
    req.headers?.['x-active-salon-id'] ??
    req.headers?.['x-salon-id'];

  if (raw === undefined || raw === null) return null;
  const str = String(raw).trim();
  if (str === '' || !/^\d+$/.test(str)) return null;

  const n = Number(str);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Membresía activa del usuario en el salón.
 * @returns {Promise<{sub_rol: string}|null>}
 */
async function getActiveMembership(salonId, userId, tenantId) {
  // `salon_miembros` está bajo RLS por `app.tenant_id`, y `usuarios` solo deja leer
  // la fila propia cuando `app.current_user_id` está puesto. Consultar aquí sin
  // contexto devolvía cero filas y el guard respondía 403 a un dueño legítimo:
  // pasaba inadvertido porque los mocks no ejecutan RLS.
  //
  // Se resuelve dentro de UNA transacción, en este orden:
  //   1. `app.user_id` con el id de la sesión          → permite leer la fila propia
  //   2. `usuarios.tenant_id`                          → el inquilino real
  //   3. `app.tenant_id`                               → habilita la política de salon_miembros
  //   4. la membresía
  // `tenantId` se usa si el token ya lo trae; si no, se resuelve en el paso 2. Así el
  // guard no depende de que otro middleware haya fijado el contexto en otra conexión.
  const consultar = async (client) => {
    let tenant = tenantId === undefined || tenantId === null ? '' : String(tenantId);

    await client.query("SELECT set_config('app.user_id', $1, true)", [String(userId)]);

    if (tenant === '') {
      const u = await client.query('SELECT tenant_id FROM usuarios WHERE id = $1', [userId]);
      const filas = (u && u.rows) || [];
      tenant = filas.length && filas[0].tenant_id !== null ? String(filas[0].tenant_id) : '';
    }

    if (tenant !== '') {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant]);
    }

    const r = await client.query(
      // E-02c (D-GL-027): la membresía se lee del modelo canónico. El `sub_rol`
      // se devuelve con la etiqueta heredada porque los llamadores comparan
      // contra DUEÑO/ADMINISTRADOR/RECEPCIONISTA; si la fila no la trae se
      // deriva del rol, nunca se devuelve 'OWNER' (que no matchearía con DUEÑO
      // y dejaría al propietario fuera de su propio salón).
      `SELECT CASE
                WHEN m.sub_rol IS NOT NULL AND m.sub_rol <> '' THEN upper(m.sub_rol)
                WHEN m.role = 'OWNER'   THEN 'DUEÑO'
                WHEN m.role = 'ADMIN'   THEN 'ADMINISTRADOR'
                WHEN m.role = 'MANAGER' THEN 'RECEPCIONISTA'
                ELSE 'EMPLEADO'
              END AS sub_rol
         FROM memberships m
         JOIN business_profiles bp ON bp.id = m.business_profile_id
        WHERE bp.id = left('salon-' || $1::text, 36)
          AND m.user_id = $2 AND m.status = $3`,
      [salonId, userId, 'ACTIVE']
    );
    return r;
  };

  const res = await runInTenantTransaction({ pool }, null, consultar);
  if (res.rows.length === 0) return null;
  return { sub_rol: String(res.rows[0].sub_rol || '').toUpperCase() };
}

/**
 * Fábrica de middleware: exige que req.user sea miembro ACTIVO del salón de la
 * petición con uno de los sub_roles indicados.
 *
 * Deja disponible `req.salonId` y `req.salonMembership` para el controlador,
 * de modo que el chequeo no se repita ni se pueda desincronizar.
 *
 * @param {...string} allowedRoles sub_roles aceptados (por defecto DUEÑO)
 */
function makeSalonRoleGuard(roles, opts = {}) {
  const allowed = (roles.length > 0 ? roles : [SUB_ROLES.DUENO])
    .map((r) => String(r).toUpperCase());
  const notMemberMessage = opts.notMemberMessage || 'No perteneces a este salón.';
  const forbiddenMessage =
    opts.forbiddenMessage || 'No tienes permisos de administración en este salón.';

  return async function salonRoleGuard(req, res, next) {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Acceso denegado. Autenticación requerida.' });
    }

    const salonId = resolveSalonId(req);
    if (salonId === null) {
      return res.status(400).json({ error: 'salon_id es obligatorio.' });
    }

    try {
      const membership = await getActiveMembership(salonId, req.user.id, req.user.tenant_id);

      if (!membership) {
        return res.status(403).json({ error: notMemberMessage });
      }

      if (!allowed.includes(membership.sub_rol)) {
        return res.status(403).json({ error: forbiddenMessage });
      }

      req.salonId = salonId;
      req.salonMembership = membership;
      return next();
    } catch (error) {
      // Falla cerrado: un error de DB no debe otorgar acceso.
      console.error('❌ ERROR ownerGuard:', error.message);
      return res.status(500).json({ error: 'Error al verificar permisos del salón.' });
    }
  };
}

/**
 * Fábrica genérica: exige que req.user sea miembro ACTIVO del salón de la
 * petición con uno de los sub_roles indicados (por defecto DUEÑO).
 */
function requireSalonRole(...roles) {
  return makeSalonRoleGuard(roles);
}

/** Solo el propietario del salón. */
const requireOwnerRole = makeSalonRoleGuard([SUB_ROLES.DUENO]);

/**
 * Propietario o administrador. Conserva el mensaje exacto que ya devolvía
 * salonController.inviteMember (salonController.js:166) para no alterar el
 * contrato observable del endpoint en su ruta de error.
 */
const requireSalonAdmin = makeSalonRoleGuard([SUB_ROLES.DUENO, SUB_ROLES.ADMINISTRADOR], {
  forbiddenMessage:
    'No tienes permisos de administración en este salón para invitar personal.',
});

/**
 * Protege al propietario frente a endpoints de mutación de miembros.
 *
 * Los endpoints actuales (salonRoutes.js) no permiten modificar ni eliminar
 * miembros, así que esta guarda es preventiva: se adjunta a cualquier ruta
 * nueva que reciba un `user_id` objetivo y garantiza que
 *   (a) no se degrade/desactive a un DUEÑO activo, y
 *   (b) no se pueda dejar al salón sin ningún DUEÑO activo.
 *
 * Requiere que `requireSalonRole` haya corrido antes (usa req.salonId).
 */
async function protectOwnerMember(req, res, next) {
  const targetRaw =
    req.params?.userId ??
    req.params?.memberId ??
    req.body?.user_id ??
    req.body?.userId;
  const targetId = targetRaw === undefined ? null : Number(String(targetRaw).trim());

  if (targetId === null || !Number.isSafeInteger(targetId) || targetId <= 0) {
    return res.status(400).json({ error: 'user_id objetivo es obligatorio.' });
  }

  try {
    const owners = await pool.query(
      // E-02c: propietarios desde el modelo canónico.
      `SELECT m.user_id
         FROM memberships m
         JOIN business_profiles bp ON bp.id = m.business_profile_id
        WHERE bp.id = left('salon-' || $1::text, 36)
          AND m.role = 'OWNER' AND m.status = $2`,
      [req.salonId, 'ACTIVE']
    );

    const ownerIds = owners.rows.map((r) => Number(r.user_id));

    if (ownerIds.includes(targetId) && ownerIds.length <= 1) {
      return res.status(409).json({
        error: 'No se puede modificar, degradar ni desactivar al único propietario del salón.',
      });
    }

    // Si el objetivo no es propietario, no hay riesgo de dejar el salón sin DUEÑO,
    // pero se rechaza de forma explícita si el salón ya no tuviera ninguno.
    if (ownerIds.length === 0) {
      return res.status(409).json({
        error: 'El salón no tiene un propietario activo. Operación bloqueada por seguridad.',
      });
    }

    req.targetUserId = targetId;
    return next();
  } catch (error) {
    console.error('❌ ERROR protectOwnerMember:', error.message);
    return res.status(500).json({ error: 'Error al verificar el miembro objetivo.' });
  }
}

/**
 * Exige que el usuario autenticado sea propietario (DUEÑO) de al menos una sede activa
 * (ya sea como id_dueno en salones o sub_rol = 'DUEÑO' en salon_miembros).
 * No requiere que la petición especifique un salon_id individual.
 */
async function requireAnyOwnerSede(req, res, next) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: 'Acceso denegado. Autenticación requerida.' });
  }

  try {
    const ownedRes = await pool.query(
      // E-02c: sedes propias por id_dueno o por membership OWNER canónica.
      `SELECT DISTINCT s.id
         FROM salones s
    LEFT JOIN business_profiles bp ON bp.id = left('salon-' || s.id::text, 36)
    LEFT JOIN memberships m ON m.business_profile_id = bp.id
                            AND m.user_id = $1 AND m.status = 'ACTIVE'
        WHERE s.id_dueno = $1 OR m.role = 'OWNER'`,
      [req.user.id]
    );

    if (ownedRes.rows.length === 0) {
      return res.status(403).json({ error: 'No tienes sedes registradas como propietario.' });
    }

    req.ownedSalonIds = ownedRes.rows.map((r) => Number(r.id));
    return next();
  } catch (error) {
    console.error('❌ ERROR requireAnyOwnerSede:', error.message);
    return res.status(500).json({ error: 'Error al verificar pertenencia de sedes del propietario.' });
  }
}

module.exports = {
  SUB_ROLES,
  resolveSalonId,
  getActiveMembership,
  requireSalonRole,
  requireOwnerRole,
  requireSalonAdmin,
  protectOwnerMember,
  requireAnyOwnerSede,
};

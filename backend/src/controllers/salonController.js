const { pool } = require('../config/db');
const crypto = require('crypto');
const { hasEntitlement, PLAN_ENTITLEMENTS, SAAS_CAPABILITIES } = require('../config/saasEntitlements');
const { ensureSalonOwnerIdentity } = require('../services/salonIdentity');
const saasMembershipService = require('../services/saasMembershipService');
const {
  listSalonMembers,
  getMemberRole,
  canAdminSalon,
  ensureMembership,
} = require('../services/salonMembership');

// ==========================================
// 🏢 OBTENER MI SALÓN DE BELLEZA (SaaS Owner Profile)
// ==========================================
exports.getMySalon = async (req, res) => {
  try {
    const userId = req.user.id;
    const activeSalonHeader = req.headers?.['x-active-salon-id'] || req.headers?.['x-salon-id'];
    let activeSalonId = null;
    if (activeSalonHeader !== undefined && activeSalonHeader !== null && activeSalonHeader !== '') {
      const normalized = String(activeSalonHeader).trim();
      if (!/^\d+$/.test(normalized) || !Number.isSafeInteger(Number(normalized)) || Number(normalized) < 1) {
        return res.status(400).json({ error: 'x-active-salon-id debe ser un identificador numérico válido.' });
      }
      activeSalonId = Number(normalized);
    }

    // La pertenencia se resuelve en `memberships`, que es la fuente única
    // (D-GL-027, D-0). Antes se buscaba sólo por `salones.id_dueno`, de modo que
    // un OWNER o ADMIN invitado no encontraba su salón.
    const salonRes = await pool.query(
      `SELECT s.id, s.nombre_salon, s.nit, s.direccion, s.telefono, s.ciudad,
              s.plan_saas, s.id_dueno, s.latitude, s.longitude,
              s.location_enabled, s.location_public
         FROM memberships m
         JOIN salones s ON s.business_profile_id = m.business_profile_id
        WHERE m.user_id = $1 AND m.status = 'ACTIVE'
          AND ($2::integer IS NULL OR s.id = $2)
        ORDER BY s.id
        LIMIT 1`,
      [userId, activeSalonId]
    );

    const salon = salonRes.rows[0] || null;

    // Sin salón se devuelve `null`, no un salón de mentira. Hasta aquí había un
    // objeto escrito a mano («Salón Elegance Studio», con NIT y dirección
    // inventados) que se servía en producción cuando la consulta no encontraba
    // nada: la pantalla mostraba un negocio que no existe.
    if (!salon) {
      return res.json({
        success: true,
        salon: null,
        members: [],
        message: 'Tu cuenta no tiene un salón activo. Crea uno o acepta una invitación.',
      });
    }

    const plan = salon.plan_saas || 'FREE_TRIAL';
    const activeEntitlements = PLAN_ENTITLEMENTS[plan.toUpperCase()] || [];

    // E-02b (D-GL-027): el equipo se lee de `memberships`, no de la tabla
    // heredada. Si el salón aún no tiene identidad provisionada (migración 113),
    // la lista sale vacía en vez de reventar el endpoint.
    const membersRes = { rows: await listSalonMembers(pool, salon.id) };

    res.json({
      success: true,
      salon: {
        ...salon,
        entitlements: activeEntitlements,
        can_show_on_map: salon.location_enabled && salon.location_public && hasEntitlement(plan, SAAS_CAPABILITIES.MAP_VISIBILITY)
      },
      members: membersRes.rows
    });
  } catch (error) {
    console.error('❌ ERROR GET MY SALON:', error.message);
    res.status(500).json({ error: 'Error al obtener información del salón' });
  }
};

// ==========================================
// 🏢 CREAR SALÓN DE BELLEZA (SaaS Owner Onboarding)
// ==========================================
exports.createSalon = async (req, res) => {
  console.log(`🏢 createSalon solicitado por Usuario ID ${req.user ? req.user.id : 'desconocido'}`);
  try {
    const ownerId = req.user.id;
    const { nombre_salon, nit, direccion, telefono, ciudad, latitude, longitude, location_public } = req.body;

    if (!nombre_salon) {
      return res.status(400).json({ error: 'El nombre del salón es obligatorio.' });
    }

    const lat = latitude !== undefined && latitude !== null ? parseFloat(latitude) : null;
    const lon = longitude !== undefined && longitude !== null ? parseFloat(longitude) : null;
    const hasValidCoords = lat !== null && !isNaN(lat) && lon !== null && !isNaN(lon);
    const locationEnabled = hasValidCoords;
    const isPublic = location_public !== undefined ? Boolean(location_public) : true;

    // Insertar salón en la base de datos con PostGIS si hay coordenadas válidas
    const query = `
      INSERT INTO salones (
        nombre_salon, nit, direccion, telefono, ciudad, id_dueno, plan_saas,
        latitude, longitude, ubicacion, location_enabled, location_public
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, 'FREE_TRIAL',
        $7, $8, 
        CASE WHEN $7::numeric IS NOT NULL AND $8::numeric IS NOT NULL 
             THEN ST_SetSRID(ST_MakePoint($8, $7), 4326)::geography 
             ELSE NULL END,
        $9, $10
      )
      RETURNING id, nombre_salon, nit, direccion, ciudad, telefono, plan_saas, latitude, longitude, location_enabled, location_public`;

    const salonRes = await pool.query(query, [
      nombre_salon,
      nit || null,
      direccion || null,
      telefono || null,
      ciudad || null,
      ownerId,
      hasValidCoords ? lat : null,
      hasValidCoords ? lon : null,
      locationEnabled,
      isPublic
    ]);

    const salon = salonRes.rows[0];

    // T-127 (D-GL-027): la tabla heredada `salon_miembros` ya no se escribe.
    // El dueño queda en `memberships` con el rol canónico mediante
    // `ensureSalonOwnerIdentity`, que es la única fuente de identidad.

    // E-02a (D-GL-027): el salón nace con su identidad canónica
    // (business_profiles + memberships). Sin esto, `req.saas` queda vacío y toda
    // la capa SaaS responde 401 hasta que alguien llame a /api/saas/bootstrap a
    // mano. No se aborta la creación del salón si falla: la migración 113 hace
    // el backfill y el error queda en el log con el id del salón.
    try {
      const identity = await ensureSalonOwnerIdentity(pool, {
        salonId: salon.id,
        ownerUserId: ownerId,
        name: salon.nombre_salon,
        plan: salon.plan_saas || 'FREE_TRIAL',
      });
      if (!identity.provisioned) {
        console.warn(`⚠️ [createSalon] identidad no provisionada para salón ${salon.id}: ${identity.reason}`);
      }
    } catch (identityError) {
      console.error(`⚠️ [createSalon] identidad del salón ${salon.id} falló:`, identityError.message);
    }

    // Marcar rol del usuario como SALON y onboarding_completo = true
    await pool.query(
      `UPDATE usuarios SET rol = 'SALON', onboarding_completo = true WHERE id = $1`,
      [ownerId]
    );

    console.log(`🏢 Salón '${nombre_salon}' creado exitosamente para Dueño ID ${ownerId} (Ubicación: ${hasValidCoords ? `${lat}, ${lon}` : 'No especificada'})`);

    res.status(201).json({
      success: true,
      message: 'Salón registrado exitosamente en el sistema SaaS.',
      salon
    });
  } catch (error) {
    console.error('❌ ERROR CREATE SALON:', error.message);
    res.status(500).json({ error: 'Error al registrar el salón de belleza' });
  }
};

// ==========================================
// ✉️ INVITAR MIEMBRO AL EQUIPO DEL SALÓN
// ==========================================
exports.inviteMember = async (req, res) => {
  try {
    const inviterId = req.user.id;
    const { salon_id, email, sub_rol } = req.body;

    const validSubRoles = ['ADMINISTRADOR', 'PRESTADOR_INDEPENDIENTE', 'EMPLEADO', 'RECEPCIONISTA'];
    if (!salon_id || !email || !sub_rol || !validSubRoles.includes(sub_rol.toUpperCase())) {
      return res.status(400).json({
        error: 'salon_id, email y sub_rol válido (ADMINISTRADOR, PRESTADOR_INDEPENDIENTE, EMPLEADO, RECEPCIONISTA) son obligatorios.'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanSubRol = sub_rol.toUpperCase();

    // Verificar si el que invita es Dueño o Administrador del salón
    // E-02b: se evalúa sobre `memberships` (rol canónico), no sobre el texto
    // libre de `salon_miembros`.
    const puedeInvitar = await canAdminSalon(pool, salon_id, inviterId);

    if (!puedeInvitar) {
      return res.status(403).json({ error: 'No tienes permisos de administración en este salón para invitar personal.' });
    }

    const { rows: salonRows } = await pool.query(
      `SELECT s.business_profile_id, bp.name, bp.saas_plan
         FROM salones s JOIN business_profiles bp ON bp.id = s.business_profile_id WHERE s.id = $1`, [salon_id]
    );
    if (!salonRows[0]) return res.status(409).json({ error: 'El salón no está vinculado a un perfil SaaS.' });
    if (!hasEntitlement(salonRows[0].saas_plan || 'FREE_TRIAL', SAAS_CAPABILITIES.TEAM_MANAGEMENT)) {
      return res.status(403).json({ error: 'El plan actual no incluye gestión de equipo.', currentPlan: salonRows[0].saas_plan || 'FREE_TRIAL' });
    }
    const saasRole = ({ ADMINISTRADOR: 'ADMIN', RECEPCIONISTA: 'MANAGER', PRESTADOR_INDEPENDIENTE: 'MEMBER', EMPLEADO: 'MEMBER' })[cleanSubRol];
    const result = await saasMembershipService.invite({ tenantId: salonRows[0].business_profile_id, tenantName: salonRows[0].name,
      plan: salonRows[0].saas_plan || 'FREE_TRIAL', actorId: inviterId, email: cleanEmail, role: saasRole, subRole: cleanSubRol });
    return res.status(result.emailSent ? 201 : 202).json({ success: true,
      message: result.emailSent ? `Invitación enviada a ${cleanEmail}.` : `Invitación creada para ${cleanEmail}, pero no se confirmó el envío del correo.`,
      invitation_id: result.membershipId, email_sent: result.emailSent });
  } catch (error) {
    console.error('❌ ERROR INVITE MEMBER:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Error al enviar invitación de equipo', ...(error.details || {}) });
  }
};

// ==========================================
// 🤝 ACEPTAR INVITACIÓN DE SALÓN
// ==========================================
exports.acceptInvitation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'El token de invitación es obligatorio.' });
    }

    const cleanToken = String(token).trim().toLowerCase();
    if (!/^[0-9a-f]{32}$/i.test(cleanToken)) {
      return res.status(400).json({ error: 'El formato del token de invitación es inválido.' });
    }

    try {
      const accepted = await saasMembershipService.accept({ token: cleanToken, user: req.user });
      const { rows: salonRows } = await pool.query(
        'SELECT id FROM salones WHERE business_profile_id = $1 ORDER BY id LIMIT 1', [accepted.business_profile_id]
      );
      return res.json({ success: true, message: 'Invitación aceptada correctamente.',
        salon_id: salonRows[0]?.id ?? null, sub_rol: accepted.sub_rol || accepted.role });
    } catch (membershipError) {
      // Aún se aceptan invitaciones emitidas antes de la Fase 3, almacenadas en salon_invitaciones.
      if (membershipError.status !== 404) throw membershipError;
    }

    const tokenHash = crypto.createHash('sha256').update(cleanToken).digest('hex');

    // Buscar invitación válida por hash SHA-256
    const inviteRes = await pool.query(
      `SELECT id, salon_id, email, sub_rol, expires_at, usado
       FROM salon_invitaciones
       WHERE token_invitacion = $1 AND usado = false AND expires_at > NOW()`,
      [tokenHash]
    );

    if (inviteRes.rows.length === 0) {
      return res.status(400).json({ error: 'La invitación es inválida, ya fue usada o ha expirado.' });
    }

    const invitation = inviteRes.rows[0];

    // La invitación es NOMINAL: se emitió para un correo concreto. Sin esta
    // comprobación, cualquiera que obtuviera el token entraba al salón como
    // EMPLEADO o ADMINISTRADOR aunque la invitación fuera para otra persona, y
    // el invitado legítimo se encontraba la invitación ya consumida. Se compara
    // en minúsculas porque el correo se guarda normalizado.
    const emailInvitado = String(invitation.email || '').trim().toLowerCase();
    const emailUsuario = String(req.user.email || '').trim().toLowerCase();
    if (emailInvitado && emailUsuario && emailInvitado !== emailUsuario) {
      return res.status(403).json({
        error: `Esta invitación es para ${invitation.email}. Estás conectado como ${req.user.email}: entra con la cuenta invitada para aceptarla.`,
        code: 'INVITATION_EMAIL_MISMATCH'
      });
    }

    // Las dos escrituras van en UNA sola sentencia: si el INSERT entrara y el
    // UPDATE no, la invitación seguiría siendo usable y el mismo token valdría
    // dos veces. No se puede confiar en el middleware para esto: el modo
    // transacción-por-petición está ACTIVO POR DEFECTO, pero este salón no
    // depende de él (ver middleware/tenantContext.js) y no comparte transacción
    // entre consultas.
    await pool.query(
      `WITH perfil AS (
         SELECT business_profile_id AS id FROM salones WHERE id = $1
       ), membresia AS (
         -- E-02b (D-GL-027): la membership canónica se escribe en la MISMA
         -- sentencia. Si el salón no está provisionado, el perfil viene vacío y
         -- esta rama no inserta: la aceptación no se rompe por eso.
         INSERT INTO memberships
           (id, user_id, business_profile_id, role, sub_rol, status, accepted_at)
         SELECT
           md5(random()::text || clock_timestamp()::text || $2::text),
           $2,
           perfil.id,
           CASE upper(trim($3))
             WHEN 'DUEÑO' THEN 'OWNER'
             WHEN 'DUENO' THEN 'OWNER'
             WHEN 'ADMINISTRADOR' THEN 'ADMIN'
             WHEN 'ADMIN' THEN 'ADMIN'
             WHEN 'RECEPCIONISTA' THEN 'MANAGER'
             ELSE 'MEMBER'
           END,
           upper(trim($3)),
           'ACTIVE',
           CURRENT_TIMESTAMP
         FROM perfil
         ON CONFLICT (user_id, business_profile_id) DO UPDATE SET
           role = EXCLUDED.role,
           sub_rol = EXCLUDED.sub_rol,
           status = 'ACTIVE',
           accepted_at = COALESCE(memberships.accepted_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
         RETURNING 1
       )
       UPDATE salon_invitaciones SET usado = true WHERE id = $4;`,
      [invitation.salon_id, userId, invitation.sub_rol, invitation.id]
    );

    await pool.query(
      `INSERT INTO membership_audit_logs
         (business_profile_id, membership_id, actor_user_id, event_type, previous_role, new_role, previous_status, new_status, metadata)
       SELECT m.business_profile_id, m.id, $2, 'INVITATION_ACCEPTED', m.role, m.role, 'PENDING', 'ACTIVE',
              jsonb_build_object('legacySalonInvitationId', $3::text)
         FROM salones s JOIN memberships m ON m.business_profile_id = s.business_profile_id AND m.user_id = $2
        WHERE s.id = $1`, [invitation.salon_id, userId, invitation.id]
    );

    console.log(`🤝 Usuario ID ${userId} aceptó invitación como ${invitation.sub_rol} en Salón ID ${invitation.salon_id}`);

    res.json({
      success: true,
      message: `Te has unido exitosamente al salón con el rol de ${invitation.sub_rol}.`,
      salon_id: invitation.salon_id,
      sub_rol: invitation.sub_rol
    });
  } catch (error) {
    console.error('❌ ERROR ACCEPT INVITATION:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Error al procesar la aceptación de la invitación', ...(error.details || {}) });
  }
};

// ==========================================
// 📋 LISTAR MIEMBROS DE UN SALÓN
// ==========================================
exports.getSalonMembers = async (req, res) => {
  try {
    const userId = req.user.id;
    const { salonId } = req.params;

    // E-02b: pertenencia y listado sobre `memberships`.
    const pertenencia = await getMemberRole(pool, salonId, userId);

    if (!pertenencia) {
      return res.status(403).json({ error: 'No perteneces a este salón.' });
    }

    res.json({
      success: true,
      members: await listSalonMembers(pool, salonId)
    });
  } catch (error) {
    console.error('❌ ERROR GET SALON MEMBERS:', error.message);
    res.status(500).json({ error: 'Error al obtener la lista de miembros del salón' });
  }
};

// ==========================================
// 🔄 ACTUALIZAR ROL DE UN COLABORADOR
// ==========================================
exports.updateMemberRole = async (req, res) => {
  try {
    const salonId = req.salonId || req.params.salonId;
    const targetUserId = req.targetUserId || req.params.userId || req.params.memberId || req.body.user_id || req.body.userId;
    const { sub_rol } = req.body;

    const validSubRoles = ['DUEÑO', 'ADMINISTRADOR', 'PRESTADOR_INDEPENDIENTE', 'EMPLEADO', 'RECEPCIONISTA'];
    const cleanSubRol = String(sub_rol || '').trim().toUpperCase();

    if (!validSubRoles.includes(cleanSubRol)) {
      return res.status(400).json({ error: `El sub-rol '${sub_rol}' no es válido.` });
    }

    // E-02b: pertenencia sobre `memberships`, que es la única fuente.
    // T-127: ya no se escribe el espejo en `salon_miembros`.
    const actual = await getMemberRole(pool, salonId, targetUserId);

    if (!actual) {
      return res.status(404).json({ error: 'El colaborador no pertenece a este salón.' });
    }

    await ensureMembership(pool, {
      salonId,
      userId: targetUserId,
      subRol: cleanSubRol,
      createdBy: req.user.id,
    });

    res.json({
      success: true,
      message: `Rol del colaborador actualizado a ${cleanSubRol}.`,
      salon_id: Number(salonId),
      user_id: Number(targetUserId),
      new_sub_rol: cleanSubRol
    });
  } catch (error) {
    console.error('❌ ERROR UPDATE MEMBER ROLE:', error.message);
    res.status(500).json({ error: 'Error al actualizar el rol del colaborador' });
  }
};

// ==========================================
// ❌ REMOVER COLABORADOR DE UN SALÓN
// ==========================================
exports.removeMember = async (req, res) => {
  try {
    const salonId = req.salonId || req.params.salonId;
    const targetUserId = req.targetUserId || req.params.userId || req.params.memberId || req.body.user_id || req.body.userId;

    const actual = await getMemberRole(pool, salonId, targetUserId);

    if (!actual) {
      return res.status(404).json({ error: 'El colaborador no existe o ya está inactivo en este salón.' });
    }

    // E-02b: la baja se refleja en la fuente canónica.
    await ensureMembership(pool, {
      salonId,
      userId: targetUserId,
      subRol: actual.sub_rol,
      status: 'SUSPENDED',
      createdBy: req.user.id,
    });

    res.json({
      success: true,
      message: 'Colaborador removido exitosamente del salón.',
      salon_id: Number(salonId),
      removed_user_id: Number(targetUserId)
    });
  } catch (error) {
    console.error('❌ ERROR REMOVE MEMBER:', error.message);
    res.status(500).json({ error: 'Error al remover el colaborador del salón' });
  }
};

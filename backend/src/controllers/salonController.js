const { pool } = require('../config/db');
const crypto = require('crypto');
const { hasEntitlement, PLAN_ENTITLEMENTS, SAAS_CAPABILITIES } = require('../config/saasEntitlements');
const { ensureSalonOwnerIdentity } = require('../services/salonIdentity');
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

    // La pertenencia se resuelve en `memberships`, que es la fuente única
    // (D-GL-027, D-0). Antes se buscaba sólo por `salones.id_dueno`, de modo que
    // un OWNER o ADMIN invitado no encontraba su salón.
    const salonRes = await pool.query(
      `SELECT s.id, s.nombre_salon, s.nit, s.direccion, s.telefono, s.ciudad,
              s.plan_saas, s.id_dueno, s.latitude, s.longitude,
              s.location_enabled, s.location_public
         FROM memberships m
         JOIN business_profiles bp ON bp.id = m.business_profile_id
         JOIN salones s ON bp.id = left('salon-' || s.id::text, 36)
        WHERE m.user_id = $1 AND m.status = 'ACTIVE'
        ORDER BY s.id
        LIMIT 1`,
      [userId]
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

    // Generar token de invitación único de 32 caracteres (para URL en claro)
    const rawToken = crypto.randomBytes(16).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 días de validez

    await pool.query(
      `INSERT INTO salon_invitaciones (salon_id, email, sub_rol, token_invitacion, expires_at, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [salon_id, cleanEmail, cleanSubRol, tokenHash, expiresAt, inviterId]
    );

    const frontendBase = (process.env.FRONTEND_URL || 'https://glowapp-frontend-production.up.railway.app').replace(/\/$/, '');
    const inviteLink = `${frontendBase}/#/accept-invitation?token=${rawToken}`;

    console.log(`✉️ Invitación creada para ${cleanEmail} como ${cleanSubRol} en Salón ID ${salon_id}`);

    res.json({
      success: true,
      message: `Invitación generada exitosamente para ${cleanEmail}.`,
      invitation_token: rawToken,
      invite_link: inviteLink
    });
  } catch (error) {
    console.error('❌ ERROR INVITE MEMBER:', error.message);
    res.status(500).json({ error: 'Error al enviar invitación de equipo' });
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
         SELECT id FROM business_profiles WHERE id = left('salon-' || $1::text, 36)
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

    console.log(`🤝 Usuario ID ${userId} aceptó invitación como ${invitation.sub_rol} en Salón ID ${invitation.salon_id}`);

    res.json({
      success: true,
      message: `Te has unido exitosamente al salón con el rol de ${invitation.sub_rol}.`,
      salon_id: invitation.salon_id,
      sub_rol: invitation.sub_rol
    });
  } catch (error) {
    console.error('❌ ERROR ACCEPT INVITATION:', error.message);
    res.status(500).json({ error: 'Error al procesar la aceptación de la invitación' });
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

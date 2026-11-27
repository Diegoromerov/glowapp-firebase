const { pool } = require('../config/db');
const tenantRouting = require('../config/tenantRouting');
const { hasEntitlement, PLAN_ENTITLEMENTS, SAAS_CAPABILITIES } = require('../config/saasEntitlements');
const { ensureSalonOwnerIdentity } = require('../services/salonIdentity');
const saasMembershipService = require('../services/saasMembershipService');
const {
  listSalonMembers,
  getMemberRole,
  getMembershipForSalonUser,
  canAdminSalon,
  roleForSubRol,
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
    const queryClient = tenantRouting.getActiveClient() || pool;
    const salonRes = await queryClient.query(
      `SELECT s.id, s.nombre_salon, s.nit, s.direccion, s.telefono, s.ciudad,
              bp.saas_plan AS plan_saas, s.id_dueno, s.latitude, s.longitude,
              s.location_enabled, s.location_public
         FROM memberships m
         JOIN salones s ON s.business_profile_id = m.business_profile_id
         JOIN business_profiles bp ON bp.id = m.business_profile_id
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
    const membersRes = { rows: await listSalonMembers(pool, salon.id, userId) };

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

    const provision = async (client) => {
      // The owner-seed trigger still validates the authenticated actor while
      // this narrowly scoped bootstrap temporarily uses app_system.
      await client.query("SELECT set_config('app.user_id', $1, true)", [String(ownerId)]);
      // Serializa el alta por dueño. Si el cliente perdió la respuesta del
      // primer POST, la repetición ve la sede y no crea una segunda.
      await client.query('SELECT pg_advisory_xact_lock(73001, $1::integer)', [ownerId]);
      const existingSalonRes = await client.query(
        `SELECT s.id, s.nombre_salon, s.nit, s.direccion, s.ciudad, s.telefono,
                bp.saas_plan AS plan_saas, s.latitude, s.longitude, s.location_enabled, s.location_public
           FROM salones s
           JOIN memberships m ON m.business_profile_id = s.business_profile_id
           JOIN business_profiles bp ON bp.id = s.business_profile_id
          WHERE s.id_dueno = $1
            AND m.user_id = $1
            AND m.role = 'OWNER'
            AND m.status = 'ACTIVE'
          ORDER BY s.id ASC
          LIMIT 1`,
        [ownerId]
      );
      if (existingSalonRes.rows.length > 0) {
        await client.query(
          `UPDATE usuarios SET rol = 'SALON', onboarding_completo = true WHERE id = $1`,
          [ownerId]
        );
        return {
          salon: existingSalonRes.rows[0],
          identity: { provisioned: true },
          created: false,
        };
      }
      const salonRes = await client.query(query, [
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

      // T-127 (D-GL-027): memberships es la fuente canónica del owner.
      const identity = await ensureSalonOwnerIdentity(client, {
        salonId: salon.id,
        ownerUserId: ownerId,
        name: salon.nombre_salon,
        plan: salon.plan_saas || 'FREE_TRIAL',
      });
      if (!identity.provisioned) {
        throw new Error(`No se pudo provisionar identidad SaaS: ${identity.reason}`);
      }
      await client.query(
        `UPDATE usuarios SET rol = 'SALON', onboarding_completo = true WHERE id = $1`,
        [ownerId]
      );
      return { salon, identity, created: true };
    };

    let salon, identity, created;
    const activeClient = tenantRouting.getActiveClient();
    if (activeClient) {
      await activeClient.query('SAVEPOINT salon_saas_provisioning');
      try {
        await activeClient.query('SET LOCAL ROLE app_system');
        ({ salon, identity, created } = await provision(activeClient));
        await activeClient.query('SET LOCAL ROLE app_rls_user');
        await activeClient.query('RELEASE SAVEPOINT salon_saas_provisioning');
      } catch (provisionError) {
        try {
          await activeClient.query('ROLLBACK TO SAVEPOINT salon_saas_provisioning');
          await activeClient.query('SET LOCAL ROLE app_rls_user');
          await activeClient.query('RELEASE SAVEPOINT salon_saas_provisioning');
        } catch (rollbackError) {
          console.error('⚠️ No se pudo restaurar el contexto del alta SaaS:', rollbackError.message);
        }
        throw provisionError;
      }
    } else {
      const result = await tenantRouting.runAsSystem({ pool }, provision);
      salon = result.salon;
      identity = result.identity;
      created = result.created;
    }

    // T-127 (D-GL-027): el dueño queda en memberships; no se escribe la tabla heredada.
    if (!identity.provisioned) {
      console.warn(`⚠️ [createSalon] identidad no provisionada para salón ${salon.id}: ${identity.reason}`);
    }

    console.log(`🏢 Salón '${nombre_salon}' creado exitosamente para Dueño ID ${ownerId} (Ubicación: ${hasValidCoords ? `${lat}, ${lon}` : 'No especificada'})`);

    if (!created) {
      return res.status(200).json({
        success: true,
        created: false,
        message: 'El salón ya estaba registrado; se devolvió la sede existente.',
        salon
      });
    }

    res.status(201).json({
      success: true,
      created: true,
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

    const { withMembershipContext } = require('../services/salonMembership');
    const salonRows = await withMembershipContext(pool, salon_id, inviterId, async (client) => {
      const { rows } = await client.query(
        `SELECT s.business_profile_id, bp.name, bp.saas_plan
           FROM salones s JOIN business_profiles bp ON bp.id = s.business_profile_id WHERE s.id = $1`, [salon_id]
      );
      return rows;
    });
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
      const { withBusinessProfileContext } = require('../services/salonMembership');
      const salonRows = await withBusinessProfileContext(pool, accepted.business_profile_id, userId, async (client) => {
        const { rows } = await client.query(
          'SELECT id FROM salones WHERE business_profile_id = $1 ORDER BY id LIMIT 1', [accepted.business_profile_id]
        );
        return rows;
      });
      return res.json({ success: true, message: 'Invitación aceptada correctamente.',
        salon_id: salonRows[0]?.id ?? null, sub_rol: accepted.sub_rol || accepted.role });
    } catch (membershipError) {
      // Aún se aceptan invitaciones emitidas antes de la Fase 3, almacenadas en salon_invitaciones.
      if (membershipError.status !== 404) throw membershipError;
    }

    const accepted = await saasMembershipService.acceptLegacySalonInvitation({ token: cleanToken, user: req.user });

    console.log(`🤝 Usuario ID ${userId} aceptó invitación como ${accepted.sub_rol} en Salón ID ${accepted.salon_id}`);

    res.json({
      success: true,
      message: `Te has unido exitosamente al salón con el rol de ${accepted.sub_rol}.`,
      salon_id: accepted.salon_id,
      sub_rol: accepted.sub_rol
    });
  } catch (error) {
    console.error('❌ ERROR ACCEPT INVITATION:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Error al procesar la aceptación de la invitación', ...(error.code ? { code: error.code } : {}), ...(error.details || {}) });
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
      members: await listSalonMembers(pool, salonId, userId)
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

    const actual = await getMembershipForSalonUser(pool, salonId, targetUserId);

    if (!actual) {
      return res.status(404).json({ error: 'El colaborador no pertenece a este salón.' });
    }

    const updated = await saasMembershipService.changeRole({
      tenantId: actual.business_profile_id,
      memberId: actual.id,
      actorId: req.user.id,
      role: roleForSubRol(cleanSubRol),
      subRole: cleanSubRol,
    });

    res.json({
      success: true,
      message: `Rol del colaborador actualizado a ${cleanSubRol}.`,
      salon_id: Number(salonId),
      user_id: Number(targetUserId),
      new_sub_rol: updated.sub_rol || cleanSubRol
    });
  } catch (error) {
    console.error('❌ ERROR UPDATE MEMBER ROLE:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Error al actualizar el rol del colaborador', ...(error.details || {}) });
  }
};

// ==========================================
// ❌ REMOVER COLABORADOR DE UN SALÓN
// ==========================================
exports.removeMember = async (req, res) => {
  try {
    const salonId = req.salonId || req.params.salonId;
    const targetUserId = req.targetUserId || req.params.userId || req.params.memberId || req.body.user_id || req.body.userId;

    const actual = await getMembershipForSalonUser(pool, salonId, targetUserId);

    if (!actual) {
      return res.status(404).json({ error: 'El colaborador no existe o ya está inactivo en este salón.' });
    }

    await saasMembershipService.setStatus({
      tenantId: actual.business_profile_id,
      memberId: actual.id,
      actorId: req.user.id,
      status: 'REMOVED',
    });

    res.json({
      success: true,
      message: 'Colaborador removido exitosamente del salón.',
      salon_id: Number(salonId),
      removed_user_id: Number(targetUserId)
    });
  } catch (error) {
    console.error('❌ ERROR REMOVE MEMBER:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Error al remover el colaborador del salón', ...(error.details || {}) });
  }
};


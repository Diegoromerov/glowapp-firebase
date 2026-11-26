const crypto = require('crypto');
const { pool } = require('../config/db');
const tenantRouting = require('../config/tenantRouting');
const emailService = require('./emailService');
const usageMeteringService = require('./usageMeteringService');
const { roleForSubRol } = require('./salonMembership');

const VALID_ROLES = new Set(['ADMIN', 'MANAGER', 'MEMBER', 'VIEWER']);
const TOKEN_TTL_DAYS = 7;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function setMembershipContext(client, tenantId, actorId) {
  await client.query("SELECT set_config('app.user_id', $1, true)", [String(actorId)]);
  if (tenantId !== null && tenantId !== undefined && tenantId !== '') {
    await client.query("SELECT set_config('app.business_profile_id', $1, true)", [String(tenantId)]);
  }
}

async function lockTenant(client, tenantId) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [String(tenantId)]);
}

function audit(client, { tenantId, membershipId, actorId, event, previousRole, newRole, previousStatus, newStatus, metadata = {} }) {
  return client.query(
    `INSERT INTO membership_audit_logs
       (business_profile_id, membership_id, actor_user_id, event_type, previous_role, new_role, previous_status, new_status, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [tenantId, membershipId || null, actorId || null, event, previousRole || null, newRole || null,
      previousStatus || null, newStatus || null, JSON.stringify(metadata)]
  );
}

async function expireInvitations(client, tenantId, actorId) {
  await client.query(
    `WITH candidates AS MATERIALIZED (
       SELECT id, role, status FROM memberships
        WHERE business_profile_id = $1 AND status IN ('PENDING','INVITED')
          AND invite_expires_at IS NOT NULL AND invite_expires_at <= NOW()
        FOR UPDATE
     ), expired AS (
       UPDATE memberships m SET status = 'EXPIRED', invite_token = NULL, invite_token_hash = NULL,
         invite_expires_at = NULL, updated_at = NOW()
         FROM candidates c WHERE m.id = c.id
       RETURNING m.id, m.role, c.status AS previous_status
     )
     INSERT INTO membership_audit_logs
       (business_profile_id, membership_id, actor_user_id, event_type, previous_role, new_role, previous_status, new_status, metadata)
     SELECT $1, id, $2, 'INVITATION_EXPIRED', role, role, previous_status, 'EXPIRED', '{}'::jsonb FROM expired`, [tenantId, actorId]
  );
}

function inviteUrl(token) {
  const base = (process.env.GLOW_PROVIDER_URL || 'https://glowapp-provider.web.app').replace(/\/$/, '');
  return `${base}/#/auth/accept-invitation?token=${encodeURIComponent(token)}`;
}

async function sendInvitation({ email, token, tenantName, role }) {
  if (!process.env.BREVO_API_KEY && !(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)) {
    return { devMode: true };
  }
  const link = inviteUrl(token);
  const safeName = String(tenantName || 'tu salón').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const html = `<div style="font-family:Arial,sans-serif;color:#251f1a;max-width:560px;margin:auto"><h2>Invitación al equipo de GlowApp</h2><p>Te invitaron a unirte a <strong>${safeName}</strong> con el rol <strong>${role}</strong>.</p><p>La invitación vence en ${TOKEN_TTL_DAYS} días y solo puede aceptarse desde la cuenta asociada a este correo.</p><p><a href="${link}" style="display:inline-block;background:#c5a052;color:#201a15;padding:12px 20px;border-radius:8px;text-decoration:none">Revisar invitación</a></p><p>Si no esperabas este correo, puedes ignorarlo.</p></div>`;
  return emailService.sendEmail({
    to: email,
    subject: `Invitación para unirte a ${tenantName || 'un salón'} en GlowApp`,
    data: { html, text: `Te invitaron a ${tenantName || 'un salón'} como ${role}. Acepta la invitación aquí: ${link}` }
  });
}

async function list(tenantId, actorId) {
  const client = await pool.connect();
  let rows;
  try {
    await client.query('BEGIN');
    await setMembershipContext(client, tenantId, actorId);
    const result = await client.query(
    `SELECT m.id, m.user_id, m.role,
            CASE WHEN m.status IN ('PENDING','INVITED') AND m.invite_expires_at <= NOW() THEN 'EXPIRED' ELSE m.status END AS status,
            m.invited_at, m.accepted_at, m.invite_expires_at,
            COALESCE(u.email, m.invite_email) AS email, u.nombre AS full_name, u.foto_url AS avatar_url
       FROM memberships m
       LEFT JOIN LATERAL (
         SELECT info.email, info.nombre, info.foto_url
           FROM app_saas_team_user_info($1) info
          WHERE info.user_id = m.user_id
       ) u ON TRUE
      WHERE m.business_profile_id = $1
      ORDER BY CASE m.role WHEN 'OWNER' THEN 1 WHEN 'ADMIN' THEN 2 WHEN 'MANAGER' THEN 3 WHEN 'MEMBER' THEN 4 WHEN 'VIEWER' THEN 5 ELSE 6 END,
               m.accepted_at DESC NULLS LAST, m.invited_at DESC`, [tenantId]
    );
    rows = result.rows;
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  return rows;
}

async function invite({ tenantId, tenantName, plan, actorId, email, role, subRole }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
    const error = new Error('Email inválido'); error.status = 400; throw error;
  }
  const normalizedRole = String(role || 'MEMBER').toUpperCase();
  if (!VALID_ROLES.has(normalizedRole)) {
    const error = new Error('Rol inválido'); error.status = 400; error.details = { validRoles: [...VALID_ROLES] }; throw error;
  }

  const client = await pool.connect();
  let membership;
  let token;
  let event = 'INVITED';
  try {
    await client.query('BEGIN');
    await setMembershipContext(client, tenantId, actorId);
    await lockTenant(client, tenantId);
    await expireInvitations(client, tenantId, actorId);
    const { rows: userRows } = await client.query('SELECT user_id AS id, email FROM app_saas_find_user_by_email($1)', [normalizedEmail]);
    const userId = userRows[0]?.id || null;
    if (!userId) {
      const error = new Error('La persona debe crear su cuenta GlowApp antes de recibir una invitación.');
      error.status = 404;
      throw error;
    }
    const { rows: existingRows } = await client.query(
      `SELECT * FROM memberships WHERE business_profile_id = $1 AND
        (($2::integer IS NOT NULL AND user_id = $2) OR lower(invite_email) = $3)
       ORDER BY CASE WHEN status = 'ACTIVE' THEN 0 ELSE 1 END LIMIT 1 FOR UPDATE`,
      [tenantId, userId, normalizedEmail]
    );
    const existing = existingRows[0];
    if (existing?.status === 'ACTIVE') {
      const error = new Error('El usuario ya es miembro activo'); error.status = 409; throw error;
    }

    const { rows: countRows } = await client.query(
      `SELECT COUNT(*)::int AS count FROM memberships WHERE business_profile_id = $1 AND status IN ('ACTIVE', 'PENDING', 'INVITED')`, [tenantId]
    );
    const maxSeats = usageMeteringService.getLimit(plan, 'TEAM_SEATS');
    const occupiesSeat = !existing || !['PENDING', 'INVITED'].includes(existing.status);
    if (occupiesSeat && maxSeats !== null && countRows[0].count >= maxSeats) {
      const error = new Error('Límite de asientos alcanzado'); error.status = 403;
      error.details = { current: countRows[0].count, max: maxSeats, plan, upgradeUrl: '/api/saas/billing/checkout' }; throw error;
    }

    token = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 86400000);
    if (existing) {
      event = 'INVITATION_RESENT';
      const result = await client.query(
        `UPDATE memberships SET user_id = COALESCE(user_id, $1), invite_email = $2, role = $3, sub_rol = COALESCE($8, sub_rol), status = 'PENDING',
             invite_token = NULL, invite_token_hash = $4, invite_expires_at = $5, invited_at = NOW(), invited_by = $6,
             accepted_at = NULL, removed_at = NULL, removed_by = NULL, updated_at = NOW()
          WHERE id = $7 RETURNING *`,
        [userId, normalizedEmail, normalizedRole, hashToken(token), expiresAt, actorId, existing.id, subRole || null]
      );
      membership = result.rows[0];
    } else {
      const result = await client.query(
        `INSERT INTO memberships
           (id, business_profile_id, user_id, invite_email, role, sub_rol, status, invited_by, invited_at, invite_token_hash, invite_expires_at)
         VALUES ($1,$2,$3,$4,$5,$9,'PENDING',$6,NOW(),$7,$8) RETURNING *`,
        [crypto.randomUUID(), tenantId, userId, normalizedEmail, normalizedRole, actorId,
          hashToken(token), expiresAt, subRole || null]
      );
      membership = result.rows[0];
    }
    await audit(client, { tenantId, membershipId: membership.id, actorId, event, previousRole: existing?.role, newRole: normalizedRole,
      previousStatus: existing?.status, newStatus: 'PENDING', metadata: { email: normalizedEmail } });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') { error.status = 409; error.message = 'Ya existe una invitación pendiente para este correo'; }
    throw error;
  } finally { client.release(); }

  let emailSent = false;
  try {
    const result = await sendInvitation({ email: normalizedEmail, token, tenantName, role: normalizedRole });
    emailSent = !result?.devMode;
  } catch (error) {
    console.error('[saasMembershipService] invitation email failed:', error.message);
  }
  return { membershipId: membership.id, email: normalizedEmail, role: normalizedRole, expiresAt: membership.invite_expires_at, emailSent };
}

async function accept({ token, user }) {
  if (!/^[0-9a-f]{32}$/i.test(String(token || ''))) {
    const error = new Error('Token de invitación inválido'); error.status = 400; throw error;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setMembershipContext(client, null, user.id);
    const { rows: lookupRows } = await client.query(
      `SELECT business_profile_id FROM memberships
        WHERE (invite_token_hash = $1 OR invite_token = $2) AND status IN ('PENDING','INVITED')
          AND user_id = $3 LIMIT 1`,
      [hashToken(token), token, user.id]
    );
    const tenantId = lookupRows[0]?.business_profile_id;
    if (!tenantId) { const error = new Error('La invitación no existe o ya fue aceptada'); error.status = 404; throw error; }
    await setMembershipContext(client, tenantId, user.id);
    await lockTenant(client, tenantId);
    const { rows } = await client.query(
      `SELECT m.* FROM memberships m
        WHERE m.business_profile_id = $3 AND (m.invite_token_hash = $1 OR m.invite_token = $2) AND m.status IN ('PENDING','INVITED')
        FOR UPDATE OF m`, [hashToken(token), token, tenantId]
    );
    const membership = rows[0];
    if (!membership || (membership.invite_expires_at && new Date(membership.invite_expires_at) <= new Date())) {
      const error = new Error('La invitación no existe, venció o ya fue aceptada'); error.status = 404; throw error;
    }
    const invitedEmail = String(membership.invite_email || '').toLowerCase();
    const currentEmail = String(user.email || '').trim().toLowerCase();
    if (invitedEmail && invitedEmail !== currentEmail) {
      const error = new Error('Inicia sesión con el correo al que se envió la invitación'); error.status = 403; throw error;
    }
    if (membership.user_id && Number(membership.user_id) !== Number(user.id)) {
      const error = new Error('Esta invitación pertenece a otra cuenta'); error.status = 403; throw error;
    }
    const { rows: duplicate } = await client.query(
      `SELECT id FROM memberships WHERE business_profile_id = $1 AND user_id = $2 AND id <> $3 AND status = 'ACTIVE' FOR UPDATE`,
      [membership.business_profile_id, user.id, membership.id]
    );
    if (duplicate.length) {
      const error = new Error('Ya tienes una membresía activa para este negocio'); error.status = 409; throw error;
    }
    await client.query("SELECT set_config('app.membership_accepting_id', $1, true)", [String(membership.id)]);
    const updated = await client.query(
      `UPDATE memberships SET user_id = $1, invite_email = lower($2), status = 'ACTIVE', accepted_at = NOW(),
           invite_token = NULL, invite_token_hash = NULL, invite_expires_at = NULL, updated_at = NOW()
        WHERE id = $3 RETURNING *`, [user.id, currentEmail, membership.id]
    );
    await audit(client, { tenantId: membership.business_profile_id, membershipId: membership.id, actorId: user.id,
      event: 'INVITATION_ACCEPTED', previousRole: membership.role, newRole: membership.role,
      previousStatus: membership.status, newStatus: 'ACTIVE' });
    await client.query('COMMIT');
    return updated.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') { error.status = 409; error.message = 'Ya tienes una membresía en este negocio'; }
    throw error;
  } finally { client.release(); }
}

async function acceptLegacySalonInvitation({ token, user }) {
  const cleanToken = String(token || '').trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/i.test(cleanToken)) {
    const error = new Error('Token de invitación inválido'); error.status = 400; throw error;
  }
  if (!Number.isSafeInteger(Number(user?.id)) || Number(user.id) <= 0) {
    const error = new Error('La sesión no tiene un usuario válido'); error.status = 401; throw error;
  }
  const tokenHash = hashToken(cleanToken);
  const currentEmail = String(user?.email || '').trim().toLowerCase();
  if (!currentEmail) { const error = new Error('La sesión no tiene un correo válido'); error.status = 401; throw error; }

  return tenantRouting.runAsSystem({ pool }, async (client) => {
    await client.query("SELECT set_config('app.user_id', $1, true)", [String(user.id)]);
    const { rows: inviteRows } = await client.query(
      `SELECT si.id, si.salon_id, si.email, si.sub_rol, si.creado_por, si.creado_at,
              s.business_profile_id, bp.saas_plan, bp.name AS business_name
         FROM salon_invitaciones si
         JOIN salones s ON s.id = si.salon_id
         JOIN business_profiles bp ON bp.id = s.business_profile_id
        WHERE si.token_invitacion = $1 AND si.usado = false AND si.expires_at > NOW()
        LIMIT 1`, [tokenHash]
    );
    const invitationInicial = inviteRows[0];
    if (!invitationInicial) {
      const error = new Error('La invitación es inválida, ya fue usada o ha expirado.'); error.status = 400; throw error;
    }
    const invitedEmail = String(invitationInicial.email || '').trim().toLowerCase();
    if (invitedEmail && invitedEmail !== currentEmail) {
      const error = new Error('Esta invitación pertenece a otra cuenta. Inicia sesión con el correo invitado.');
      error.status = 403; error.code = 'INVITATION_EMAIL_MISMATCH'; throw error;
    }
    if (!invitationInicial.business_profile_id) {
      const error = new Error('El salón no está vinculado a un perfil SaaS.'); error.status = 409; throw error;
    }

    // Canonical invitations, seat changes and legacy invitation acceptance
    // serialize on the same advisory lock for this SaaS profile.
    await lockTenant(client, invitationInicial.business_profile_id);
    await setMembershipContext(client, invitationInicial.business_profile_id, user.id);
    const { rows: lockedInvites } = await client.query(
      `SELECT si.id, si.salon_id, si.email, si.sub_rol, si.creado_por, si.creado_at,
              s.business_profile_id, bp.saas_plan, bp.name AS business_name
         FROM salon_invitaciones si
         JOIN salones s ON s.id = si.salon_id
         JOIN business_profiles bp ON bp.id = s.business_profile_id
        WHERE si.id = $1 AND si.token_invitacion = $2 AND si.usado = false AND si.expires_at > NOW()
        FOR UPDATE OF si`, [invitationInicial.id, tokenHash]
    );
    const invitation = lockedInvites[0];
    if (!invitation) { const error = new Error('La invitación es inválida, ya fue usada o ha expirado.'); error.status = 400; throw error; }
    if (String(invitation.email || '').trim().toLowerCase() !== currentEmail) {
      const error = new Error('Esta invitación pertenece a otra cuenta. Inicia sesión con el correo invitado.');
      error.status = 403; error.code = 'INVITATION_EMAIL_MISMATCH'; throw error;
    }

    const normalizedSubRole = String(invitation.sub_rol || '').trim().toUpperCase();
    const legacyRoleMap = {
      ADMINISTRADOR: 'ADMIN', ADMIN: 'ADMIN',
      RECEPCIONISTA: 'MANAGER', MANAGER: 'MANAGER',
      PRESTADOR_INDEPENDIENTE: 'MEMBER', EMPLEADO: 'MEMBER', MEMBER: 'MEMBER', VIEWER: 'VIEWER',
    };
    const role = legacyRoleMap[normalizedSubRole];
    if (!role || role === 'OWNER' || roleForSubRol(normalizedSubRole) === 'OWNER') {
      const error = new Error('El rol de la invitación ya no es válido. Solicita una nueva invitación.'); error.status = 409; throw error;
    }

    await expireInvitations(client, invitation.business_profile_id, user.id);
    const { rows: existingRows } = await client.query(
      `SELECT id, status FROM memberships
        WHERE business_profile_id = $1 AND user_id = $2
        FOR UPDATE`, [invitation.business_profile_id, user.id]
    );
    if (existingRows.length) {
      const error = new Error('Ya existe una membresía para este usuario. Pide al propietario que gestione el acceso desde Equipo.');
      error.status = 409; throw error;
    }

    const { rows: countRows } = await client.query(
      `SELECT COUNT(*)::int AS count FROM memberships
        WHERE business_profile_id = $1 AND status IN ('ACTIVE','PENDING','INVITED')`, [invitation.business_profile_id]
    );
    const current = Number(countRows[0]?.count || 0);
    const plan = invitation.saas_plan || 'FREE_TRIAL';
    const maxSeats = usageMeteringService.getLimit(plan, 'TEAM_SEATS');
    if (maxSeats !== null && current >= maxSeats) {
      const error = new Error('Límite de asientos alcanzado'); error.status = 403;
      error.details = { current, max: maxSeats, plan }; throw error;
    }

    const { rows: membershipRows } = await client.query(
      `INSERT INTO memberships
         (id, user_id, business_profile_id, role, sub_rol, status, invite_email,
          invited_by, invited_at, accepted_at, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6,$7,COALESCE($8,NOW()),NOW(),$7)
       RETURNING *`,
      [crypto.randomUUID(), user.id, invitation.business_profile_id, role, normalizedSubRole,
        invitedEmail || currentEmail, invitation.creado_por || null, invitation.creado_at || null]
    );
    const membership = membershipRows[0];
    const { rowCount } = await client.query(
      `UPDATE salon_invitaciones SET usado = true, updated_at = NOW()
        WHERE id = $1 AND usado = false RETURNING id`, [invitation.id]
    );
    if (rowCount !== 1) {
      const error = new Error('La invitación ya fue aceptada por otra solicitud.'); error.status = 409; throw error;
    }
    await audit(client, { tenantId: invitation.business_profile_id, membershipId: membership.id, actorId: user.id,
      event: 'INVITATION_ACCEPTED', previousRole: membership.role, newRole: membership.role,
      previousStatus: 'PENDING', newStatus: 'ACTIVE',
      metadata: { legacySalonInvitationId: String(invitation.id), businessName: invitation.business_name } });
    return { ...membership, salon_id: invitation.salon_id, sub_rol: normalizedSubRole };
  });
}

async function changeRole({ tenantId, memberId, actorId, role, subRole }) {
  const nextRole = String(role || '').toUpperCase();
  if (!VALID_ROLES.has(nextRole)) { const error = new Error('Rol inválido'); error.status = 400; throw error; }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setMembershipContext(client, tenantId, actorId);
    const { rows } = await client.query('SELECT * FROM memberships WHERE id = $1 AND business_profile_id = $2 FOR UPDATE', [memberId, tenantId]);
    const target = rows[0];
    if (!target) { const error = new Error('Miembro no encontrado'); error.status = 404; throw error; }
    if (target.role === 'OWNER') { const error = new Error('No se puede cambiar el rol del propietario'); error.status = 400; throw error; }
    if (Number(target.user_id) === Number(actorId)) { const error = new Error('No puedes cambiar tu propio rol'); error.status = 400; throw error; }
    const defaultLegacyRole = ({ ADMIN: 'ADMINISTRADOR', MANAGER: 'RECEPCIONISTA', MEMBER: 'EMPLEADO', VIEWER: 'EMPLEADO' })[nextRole];
    const legacyRole = String(subRole || defaultLegacyRole).trim().toUpperCase();
    if (subRole && roleForSubRol(legacyRole) !== nextRole) {
      const error = new Error('El subrol no corresponde al rol SaaS solicitado'); error.status = 400; throw error;
    }
    const updated = await client.query('UPDATE memberships SET role = $1, sub_rol = $2, updated_at = NOW() WHERE id = $3 RETURNING *', [nextRole, legacyRole, memberId]);
    await audit(client, { tenantId, membershipId: memberId, actorId, event: 'ROLE_CHANGED', previousRole: target.role, newRole: nextRole,
      previousStatus: target.status, newStatus: target.status });
    await client.query('COMMIT');
    return updated.rows[0];
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

async function setStatus({ tenantId, memberId, actorId, status, plan }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setMembershipContext(client, tenantId, actorId);
    await lockTenant(client, tenantId);
    await expireInvitations(client, tenantId, actorId);
    const { rows } = await client.query('SELECT * FROM memberships WHERE id = $1 AND business_profile_id = $2 FOR UPDATE', [memberId, tenantId]);
    const target = rows[0];
    if (!target) { const error = new Error('Miembro o invitación no encontrados'); error.status = 404; throw error; }
    if (target.role === 'OWNER') { const error = new Error('No se puede suspender ni retirar al propietario'); error.status = 400; throw error; }
    if (Number(target.user_id) === Number(actorId)) { const error = new Error('No puedes retirarte desde esta pantalla'); error.status = 400; throw error; }
    const nextStatus = String(status || '').toUpperCase();
    if (!['ACTIVE', 'SUSPENDED', 'REMOVED'].includes(nextStatus)) {
      const error = new Error('Estado inválido. Usa ACTIVE, SUSPENDED o REMOVED.'); error.status = 400; throw error;
    }
    if (['PENDING', 'INVITED'].includes(target.status) && nextStatus !== 'REMOVED') {
      const error = new Error('Una invitación pendiente solo se puede cancelar.'); error.status = 409; throw error;
    }
    if (['REMOVED', 'REVOKED'].includes(target.status)) {
      const error = new Error('El miembro fue retirado; envía una nueva invitación para reactivarlo.'); error.status = 409; throw error;
    }
    if (target.status === nextStatus) {
      await client.query('COMMIT');
      return target;
    }
    if (nextStatus === 'ACTIVE' && target.status !== 'SUSPENDED') {
      const error = new Error('Solo se puede reactivar una membresía suspendida. Reenvía la invitación vencida o cancelada.');
      error.status = 409;
      throw error;
    }
    if (nextStatus === 'ACTIVE' && target.status === 'SUSPENDED') {
      const { rows: countRows } = await client.query(
        `SELECT COUNT(*)::int AS count FROM memberships WHERE business_profile_id = $1 AND status IN ('ACTIVE','PENDING','INVITED')`, [tenantId]
      );
      const maxSeats = usageMeteringService.getLimit(plan, 'TEAM_SEATS');
      if (maxSeats !== null && countRows[0].count >= maxSeats) {
        const error = new Error('Límite de asientos alcanzado para reactivar al miembro'); error.status = 403;
        error.details = { current: countRows[0].count, max: maxSeats, plan }; throw error;
      }
    }
    const updated = await client.query(
      `UPDATE memberships SET status = $1::text,
           invite_token = CASE WHEN $1::text = 'REMOVED' THEN NULL ELSE invite_token END,
           invite_token_hash = CASE WHEN $1::text = 'REMOVED' THEN NULL ELSE invite_token_hash END,
           invite_expires_at = CASE WHEN $1::text = 'REMOVED' THEN NULL ELSE invite_expires_at END,
           removed_at = CASE WHEN $1::text = 'REMOVED' THEN NOW() ELSE NULL END,
           removed_by = CASE WHEN $1::text = 'REMOVED' THEN $2 ELSE NULL END,
           updated_at = NOW() WHERE id = $3 RETURNING *`,
      [nextStatus, actorId, memberId]
    );
    const event = nextStatus === 'SUSPENDED' ? 'SUSPENDED'
      : nextStatus === 'ACTIVE' ? 'REACTIVATED'
      : ['PENDING', 'INVITED', 'EXPIRED'].includes(target.status) ? 'INVITATION_CANCELLED' : 'REMOVED';
    await audit(client, { tenantId, membershipId: memberId, actorId, event, previousRole: target.role, newRole: target.role,
      previousStatus: target.status, newStatus: nextStatus });
    await client.query('COMMIT');
    return updated.rows[0];
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

async function resend({ tenantId, memberId, actorId, tenantName, plan }) {
  const client = await pool.connect();
  let token;
  let invite;
  try {
    await client.query('BEGIN');
    await setMembershipContext(client, tenantId, actorId);
    await lockTenant(client, tenantId);
    await expireInvitations(client, tenantId, actorId);
    const { rows } = await client.query(
      `SELECT m.*, COALESCE(u.email, m.invite_email) AS email FROM memberships m
        LEFT JOIN LATERAL (
          SELECT info.email FROM app_saas_team_user_info($2) info WHERE info.user_id = m.user_id
        ) u ON TRUE
        WHERE m.id = $1 AND m.business_profile_id = $2 AND m.status IN ('PENDING','INVITED','EXPIRED') FOR UPDATE OF m`, [memberId, tenantId]
    );
    const target = rows[0];
    if (!target) { const error = new Error('Invitación pendiente no encontrada'); error.status = 404; throw error; }
    if (!target.email) { const error = new Error('La invitación no tiene correo asociado'); error.status = 409; throw error; }
    if (target.status === 'EXPIRED') {
      const { rows: countRows } = await client.query(
        `SELECT COUNT(*)::int AS count FROM memberships WHERE business_profile_id = $1 AND status IN ('ACTIVE','PENDING','INVITED')`, [tenantId]
      );
      const maxSeats = usageMeteringService.getLimit(plan, 'TEAM_SEATS');
      if (maxSeats !== null && countRows[0].count >= maxSeats) {
        const error = new Error('Límite de asientos alcanzado para reenviar la invitación'); error.status = 403;
        error.details = { current: countRows[0].count, max: maxSeats, plan }; throw error;
      }
    }
    token = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 86400000);
    await client.query(
      `UPDATE memberships SET status = 'PENDING', invite_token = NULL, invite_token_hash = $1, invite_expires_at = $2,
          accepted_at = NULL, removed_at = NULL, removed_by = NULL, invited_at = NOW(), invited_by = $3,
          updated_at = NOW() WHERE id = $4`, [hashToken(token), expiresAt, actorId, memberId]
    );
    await audit(client, { tenantId, membershipId: memberId, actorId, event: 'INVITATION_RESENT', previousRole: target.role,
      newRole: target.role, previousStatus: target.status, newStatus: 'PENDING', metadata: { email: target.email } });
    invite = { email: target.email, role: target.role };
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  try { const result = await sendInvitation({ ...invite, token, tenantName }); return { emailSent: !result?.devMode }; }
  catch (error) { console.error('[saasMembershipService] resend email failed:', error.message); return { emailSent: false }; }
}

module.exports = { VALID_ROLES, list, invite, accept, acceptLegacySalonInvitation, changeRole, setStatus, resend };

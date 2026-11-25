const express = require('express');
const { pool } = require('../config/db');
const saasContext = require('../middleware/saasContext');
const { requireRole, requireOwner, requireEntitlement } = require('../middleware/featureGate');
const { requirePermission, RESOURCES, ACTIONS } = require('../middleware/authorization.middleware');
const { authMiddleware } = require('../middleware/auth');
const membershipService = require('../services/saasMembershipService');

const router = express.Router();
router.use(authMiddleware);
router.use(saasContext);

function handleError(res, error, fallback) {
  if (error.status) return res.status(error.status).json({ error: error.message, ...(error.details || {}) });
  console.error(`[saasTeamRoutes] ${fallback}:`, error.message);
  return res.status(500).json({ error: fallback });
}

function membershipDto(membership) {
  if (!membership) return membership;
  const safe = { ...membership };
  delete safe.invite_token;
  delete safe.invite_token_hash;
  return safe;
}

router.get('/', async (req, res) => {
  if (!req.saas) return res.status(401).json({ error: 'Contexto SaaS requerido' });
  try {
    const members = await membershipService.list(req.saas.tenantId, req.user.id);
    const me = members.find((member) => Number(member.user_id) === Number(req.user.id));
    return res.json({ tenantId: req.saas.tenantId, tenantName: req.saas.name, plan: req.saas.plan,
      myRole: me?.role, members: members.map((member) => ({ ...member, isMe: Number(member.user_id) === Number(req.user.id) })) });
  } catch (error) { return handleError(res, error, 'Error obteniendo equipo'); }
});

router.post('/invite', requireRole('ADMIN'), requirePermission(RESOURCES.MEMBERSHIP, ACTIONS.MANAGE_MEMBERS),
  requireEntitlement('TEAM_MANAGEMENT'), async (req, res) => {
    try {
      const result = await membershipService.invite({ tenantId: req.saas.tenantId, tenantName: req.saas.name,
        plan: req.saas.plan, actorId: req.user.id, email: req.body?.email, role: req.body?.role });
      return res.status(result.emailSent ? 201 : 202).json({ message: result.emailSent ? 'Invitación enviada por correo' : 'Invitación creada; no se pudo confirmar el envío del correo', ...result });
    } catch (error) { return handleError(res, error, 'Error enviando invitación'); }
  });

router.post('/accept/:token', async (req, res) => {
  try {
    const membership = await membershipService.accept({ token: req.params.token, user: req.user });
    return res.json({ message: 'Invitación aceptada', membership: membershipDto(membership) });
  } catch (error) { return handleError(res, error, 'Error aceptando invitación'); }
});

router.patch('/:memberId/role', requireOwner, requirePermission(RESOURCES.MEMBERSHIP, ACTIONS.CHANGE_ROLE), async (req, res) => {
  try {
    const membership = await membershipService.changeRole({ tenantId: req.saas.tenantId, memberId: req.params.memberId,
      actorId: req.user.id, role: req.body?.role });
    return res.json({ message: 'Rol actualizado', membership: membershipDto(membership) });
  } catch (error) { return handleError(res, error, 'Error cambiando rol'); }
});

router.patch('/:memberId/status', requireRole('ADMIN'), requirePermission(RESOURCES.MEMBERSHIP, ACTIONS.MANAGE_MEMBERS), async (req, res) => {
  try {
    const membership = await membershipService.setStatus({ tenantId: req.saas.tenantId, memberId: req.params.memberId,
      actorId: req.user.id, status: req.body?.status, plan: req.saas.plan });
    return res.json({ message: 'Estado actualizado', membership: membershipDto(membership) });
  } catch (error) { return handleError(res, error, 'Error actualizando estado'); }
});

router.delete('/:memberId', requireRole('ADMIN'), requirePermission(RESOURCES.MEMBERSHIP, ACTIONS.MANAGE_MEMBERS), async (req, res) => {
  try {
    const membership = await membershipService.setStatus({ tenantId: req.saas.tenantId, memberId: req.params.memberId,
      actorId: req.user.id, status: 'REMOVED', plan: req.saas.plan });
    return res.json({ message: 'Miembro eliminado', membership: membershipDto(membership) });
  } catch (error) { return handleError(res, error, 'Error eliminando miembro'); }
});

router.post('/:memberId/resend-invite', requireRole('ADMIN'), requirePermission(RESOURCES.MEMBERSHIP, ACTIONS.MANAGE_MEMBERS), async (req, res) => {
  try {
    const result = await membershipService.resend({ tenantId: req.saas.tenantId, memberId: req.params.memberId,
      actorId: req.user.id, tenantName: req.saas.name, plan: req.saas.plan });
    return res.status(result.emailSent ? 200 : 202).json({ message: result.emailSent ? 'Invitación reenviada' : 'Invitación renovada; no se pudo confirmar el envío del correo', ...result });
  } catch (error) { return handleError(res, error, 'Error reenviando invitación'); }
});

// Acceso de solo lectura al historial auditable para OWNER/ADMIN.
router.get('/audit', requireRole('ADMIN'), requirePermission(RESOURCES.MEMBERSHIP, ACTIONS.READ), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.membership_id, a.actor_user_id, a.event_type, a.previous_role, a.new_role,
              a.previous_status, a.new_status, a.metadata, a.created_at, u.email AS actor_email
         FROM membership_audit_logs a
         LEFT JOIN LATERAL (
           SELECT info.email FROM app_saas_team_user_info($1) info WHERE info.user_id = a.actor_user_id
         ) u ON TRUE
        WHERE a.business_profile_id = $1 ORDER BY a.created_at DESC LIMIT 100`, [req.saas.tenantId]
    );
    return res.json({ tenantId: req.saas.tenantId, events: rows });
  } catch (error) { return handleError(res, error, 'Error obteniendo auditoría del equipo'); }
});

module.exports = router;

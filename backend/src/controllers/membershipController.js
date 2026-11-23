const { pool } = require('../config/db');
const membershipService = require('../services/saasMembershipService');
const { hasEntitlement } = require('../config/saasEntitlements');

function context(req) {
  const tenantId = req.membership?.business_profile_id || req.user?.businessProfileId;
  if (!tenantId) { const error = new Error('Contexto de negocio requerido'); error.status = 401; throw error; }
  return tenantId;
}

function respondError(res, error) {
  if (error.status) return res.status(error.status).json({ error: error.message, ...(error.details || {}) });
  console.error('[membershipController] Error:', error.message);
  return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
}

async function tenantInfo(tenantId) {
  const { rows } = await pool.query('SELECT id, name, saas_plan FROM business_profiles WHERE id = $1', [tenantId]);
  if (!rows[0]) { const error = new Error('Negocio no encontrado'); error.status = 404; throw error; }
  return rows[0];
}

const getMembers = async (req, res) => {
  try {
    const members = await membershipService.list(context(req));
    return res.json({ success: true, data: members.map((m) => ({
      id: m.id, userId: m.user_id, role: m.role, status: m.status,
      createdAt: m.created_at, updatedAt: m.updated_at,
      user: m.user_id ? { id: m.user_id, nombre: m.full_name, email: m.email, phone: null } : null,
      email: m.email
    })) });
  } catch (error) { return respondError(res, error); }
};

const inviteMember = async (req, res) => {
  try {
    const tenantId = context(req);
    const tenant = await tenantInfo(tenantId);
    if (!hasEntitlement(tenant.saas_plan, 'TEAM_MANAGEMENT')) {
      return res.status(403).json({ error: 'Esta función no está incluida en el plan actual.' });
    }
    const result = await membershipService.invite({ tenantId, tenantName: tenant.name, plan: tenant.saas_plan,
      actorId: req.user.id, email: req.body?.email, role: req.body?.role });
    return res.status(result.emailSent ? 201 : 202).json({ success: true, message: result.emailSent ? 'Invitación enviada por correo' : 'Invitación creada; el correo no pudo confirmarse', data: result });
  } catch (error) { return respondError(res, error); }
};

const updateRole = async (req, res) => {
  try {
    if (req.membership?.role !== 'OWNER') return res.status(403).json({ error: 'Solo el propietario puede cambiar roles.' });
    const membership = await membershipService.changeRole({ tenantId: context(req), memberId: req.params.id,
      actorId: req.user.id, role: req.body?.role });
    return res.json({ success: true, data: membership });
  } catch (error) { return respondError(res, error); }
};

const updateStatus = async (req, res) => {
  try {
    const tenantId = context(req);
    const tenant = await tenantInfo(tenantId);
    const membership = await membershipService.setStatus({ tenantId, memberId: req.params.id, actorId: req.user.id,
      status: req.body?.status, plan: tenant.saas_plan });
    return res.json({ success: true, data: membership });
  } catch (error) { return respondError(res, error); }
};

const removeMember = async (req, res) => {
  try {
    const membership = await membershipService.setStatus({ tenantId: context(req), memberId: req.params.id,
      actorId: req.user.id, status: 'REMOVED' });
    return res.json({ success: true, message: 'Miembro eliminado', data: membership });
  } catch (error) { return respondError(res, error); }
};

module.exports = { getMembers, inviteMember, updateRole, updateStatus, removeMember };

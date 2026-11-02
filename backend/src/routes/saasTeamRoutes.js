// backend/src/routes/saasTeamRoutes.js
const express = require('express');
const { pool } = require('../config/db');
const saasContext = require('../middleware/saasContext');
const { requireRole, requireOwner } = require('../middleware/featureGate');
const { authMiddleware } = require('../middleware/auth');
const crypto = require('crypto');

const router = express.Router();

// Todos los endpoints requieren auth + contexto SaaS + rol mínimo ADMIN (salvo listar)
router.use(authMiddleware);
router.use(saasContext);

/**
 * GET /api/saas/team
 * Lista miembros del tenant actual
 * Requiere: membership activa (cualquier rol)
 */
router.get('/', async (req, res) => {
  try {
    if (!req.saas) {
      return res.status(401).json({ error: 'Contexto SaaS requerido' });
    }

    const { rows } = await pool.query(`
      SELECT m.id, m.user_id, m.role, m.status, m.invited_at, m.accepted_at,
             u.email, u.nombre AS full_name, u.foto_url AS avatar_url
      FROM memberships m
      JOIN usuarios u ON u.id = m.user_id
      WHERE m.business_profile_id = $1
      ORDER BY 
        CASE m.role 
          WHEN 'OWNER' THEN 1 
          WHEN 'ADMIN' THEN 2 
          WHEN 'MANAGER' THEN 3 
          WHEN 'MEMBER' THEN 4 
          WHEN 'VIEWER' THEN 5 
          ELSE 6 
        END,
        m.accepted_at DESC NULLS LAST, m.invited_at DESC;
    `, [req.saas.tenantId]);

    // Agregar "yo" (current user) para UI
    const me = rows.find(r => r.user_id === req.user.id);
    const others = rows.filter(r => r.user_id !== req.user.id);

    res.json({
      tenantId: req.saas.tenantId,
      tenantName: req.saas.name,
      plan: req.saas.plan,
      myRole: me?.role,
      members: [
        me ? { ...me, isMe: true } : null,
        ...others.map(m => ({ ...m, isMe: false }))
      ].filter(Boolean)
    });
  } catch (error) {
    console.error('[saasTeamRoutes] Error listing members:', error.message);
    res.status(500).json({ error: 'Error obteniendo equipo' });
  }
});

/**
 * POST /api/saas/team/invite
 * Invita un nuevo miembro al tenant
 * Requiere: ADMIN u OWNER
 */
router.post('/invite', requireRole('ADMIN'), async (req, res) => {
  try {
    const { email, role = 'MEMBER', message } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Email inválido' });
    }

    const validRoles = ['ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Rol inválido', validRoles });
    }

    // No permitir invitar OWNER (solo uno por tenant)
    if (role === 'OWNER') {
      return res.status(400).json({ error: 'No se puede invitar como OWNER' });
    }

    // Verificar límite de asientos según plan
    const limits = {
      FREE_TRIAL: 3, FREEMIUM: 1, BASIC: 5, PRO: 20, ENTERPRISE: 999
    };
    const maxSeats = limits[req.saas.plan] || 1;

    const { rows: currentMembers } = await pool.query(
      `SELECT COUNT(*) as count FROM memberships 
       WHERE business_profile_id = $1 AND status IN ('ACTIVE', 'PENDING')`,
      [req.saas.tenantId]
    );

    if (parseInt(currentMembers[0].count) >= maxSeats) {
      return res.status(403).json({ 
        error: 'Límite de asientos alcanzado',
        current: parseInt(currentMembers[0].count),
        max: maxSeats,
        plan: req.saas.plan,
        upgradeUrl: '/api/saas/billing/checkout'
      });
    }

    // Buscar usuario por email
    const { rows: users } = await pool.query(
      `SELECT id, email, nombre AS full_name FROM usuarios WHERE email = $1`,
      [email.toLowerCase()]
    );

    let userId;
    let isNewUser = false;

    if (users.length === 0) {
      // Usuario no existe - crear invitado pendiente (pre-registro)
      // En producción: enviar email de invitación con link de registro
      return res.status(404).json({ 
        error: 'Usuario no registrado',
        message: 'El usuario debe registrarse primero en GlowApp. Envíale el link de registro.',
        registerUrl: `${process.env.FRONTEND_URL}/register?invite=${req.saas.tenantId}&role=${role}`
      });
    }

    userId = users[0].id;

    // Verificar si ya es miembro
    const { rows: existing } = await pool.query(
      `SELECT * FROM memberships WHERE business_profile_id = $1 AND user_id = $2`,
      [req.saas.tenantId, userId]
    );

    if (existing.length > 0) {
      const existingM = existing[0];
      if (existingM.status === 'ACTIVE') {
        return res.status(409).json({ error: 'El usuario ya es miembro activo' });
      }
      if (existingM.status === 'PENDING') {
        return res.status(409).json({ error: 'Ya hay una invitación pendiente para este usuario' });
      }
      // Reactivar si estaba INACTIVE/REMOVED
      await pool.query(
        `UPDATE memberships SET role = $1, status = 'PENDING', invited_at = NOW(), invited_by = $2 WHERE id = $3`,
        [role, req.user.id, existingM.id]
      );
      return res.json({ message: 'Invitación reactivada', membershipId: existingM.id });
    }

    // Crear invitación
    const inviteToken = crypto.randomBytes(32).toString('hex');
    const { rows } = await pool.query(`
      INSERT INTO memberships (business_profile_id, user_id, role, status, invited_by, invite_token)
      VALUES ($1, $2, $3, 'PENDING', $4, $5)
      RETURNING *;
    `, [req.saas.tenantId, userId, role, req.user.id, inviteToken]);

    // TODO: Enviar email de invitación (integrar con email.service.js)
    console.log(`[saasTeamRoutes] Invitación creada para ${email} como ${role} en tenant ${req.saas.tenantId}`);

    res.status(201).json({
      message: 'Invitación enviada',
      membership: rows[0],
      inviteToken // en dev; en prod no exponer
    });
  } catch (error) {
    console.error('[saasTeamRoutes] Error inviting member:', error.message);
    res.status(500).json({ error: 'Error enviando invitación' });
  }
});

/**
 * POST /api/saas/team/accept/:token
 * Acepta invitación (usuario logueado)
 */
router.post('/accept/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const { rows } = await pool.query(`
      UPDATE memberships 
      SET status = 'ACTIVE', accepted_at = NOW(), invite_token = NULL
      WHERE invite_token = $1 AND user_id = $2 AND status = 'PENDING'
      RETURNING *;
    `, [token, req.user.id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Invitación no encontrada o ya procesada' });
    }

    res.json({ message: 'Invitación aceptada', membership: rows[0] });
  } catch (error) {
    console.error('[saasTeamRoutes] Error accepting invite:', error.message);
    res.status(500).json({ error: 'Error aceptando invitación' });
  }
});

/**
 * PATCH /api/saas/team/:memberId/role
 * Cambia rol de un miembro
 * Requiere: OWNER (no ADMIN)
 */
router.patch('/:memberId/role', requireOwner, async (req, res) => {
  try {
    const { memberId } = req.params;
    const { role } = req.body;

    const validRoles = ['ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Rol inválido', validRoles });
    }

    // No permitir cambiar rol del owner
    const { rows: target } = await pool.query(
      `SELECT * FROM memberships WHERE id = $1 AND business_profile_id = $2`,
      [memberId, req.saas.tenantId]
    );

    if (target.length === 0) {
      return res.status(404).json({ error: 'Miembro no encontrado' });
    }

    if (target[0].role === 'OWNER') {
      return res.status(400).json({ error: 'No se puede cambiar el rol del propietario' });
    }

    // No permitir auto-degradarse (seguridad)
    if (target[0].user_id === req.user.id) {
      return res.status(400).json({ error: 'No puedes cambiar tu propio rol' });
    }

    const { rows } = await pool.query(`
      UPDATE memberships SET role = $1, updated_at = NOW()
      WHERE id = $2 AND business_profile_id = $3
      RETURNING *;
    `, [role, memberId, req.saas.tenantId]);

    res.json({ message: 'Rol actualizado', membership: rows[0] });
  } catch (error) {
    console.error('[saasTeamRoutes] Error changing role:', error.message);
    res.status(500).json({ error: 'Error cambiando rol' });
  }
});

/**
 * DELETE /api/saas/team/:memberId
 * Elimina miembro del tenant
 * Requiere: ADMIN u OWNER (OWNER no se puede eliminar)
 */
router.delete('/:memberId', requireRole('ADMIN'), async (req, res) => {
  try {
    const { memberId } = req.params;

    const { rows: target } = await pool.query(
      `SELECT * FROM memberships WHERE id = $1 AND business_profile_id = $2`,
      [memberId, req.saas.tenantId]
    );

    if (target.length === 0) {
      return res.status(404).json({ error: 'Miembro no encontrado' });
    }

    if (target[0].role === 'OWNER') {
      return res.status(400).json({ error: 'No se puede eliminar al propietario' });
    }

    // No permitir auto-eliminación
    if (target[0].user_id === req.user.id) {
      return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
    }

    await pool.query(
      `UPDATE memberships SET status = 'REMOVED', removed_at = NOW(), removed_by = $1 WHERE id = $2`,
      [req.user.id, memberId]
    );

    res.json({ message: 'Miembro eliminado' });
  } catch (error) {
    console.error('[saasTeamRoutes] Error removing member:', error.message);
    res.status(500).json({ error: 'Error eliminando miembro' });
  }
});

/**
 * POST /api/saas/team/:memberId/resend-invite
 * Reenvía invitación pendiente
 * Requiere: ADMIN u OWNER
 */
router.post('/:memberId/resend-invite', requireRole('ADMIN'), async (req, res) => {
  try {
    const { memberId } = req.params;

    const inviteToken = crypto.randomBytes(32).toString('hex');
    const { rows } = await pool.query(`
      UPDATE memberships 
      SET invite_token = $1, invited_at = NOW(), invited_by = $2, status = 'PENDING'
      WHERE id = $3 AND business_profile_id = $4 AND status = 'PENDING'
      RETURNING *;
    `, [inviteToken, req.user.id, memberId, req.saas.tenantId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Invitación pendiente no encontrada' });
    }

    // TODO: Enviar email
    console.log(`[saasTeamRoutes] Invitación reenviada para membership ${memberId}`);

    res.json({ message: 'Invitación reenviada', membership: rows[0] });
  } catch (error) {
    console.error('[saasTeamRoutes] Error resending invite:', error.message);
    res.status(500).json({ error: 'Error reenviando invitación' });
  }
});

module.exports = router;
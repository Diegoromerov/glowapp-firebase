const { Membership, User, BusinessProfile } = require('../models');

/**
 * 👥 MEMBERSHIP CONTROLLER (GLOWAPP SAAS)
 * Handles team member listings, invitations, role modifications, and status management.
 */

const getMembers = async (req, res) => {
  try {
    const memberships = await Membership.findAll({
      where: {
        business_profile_id: req.user.businessProfileId
      },
      include: [{
        model: User,
        as: 'user',
        attributes: ['id', 'nombre', 'email', 'phone']
      }]
    });

    const membersData = memberships.map(membership => ({
      id: membership.id,
      userId: membership.user_id,
      role: membership.role,
      status: membership.status,
      createdAt: membership.created_at || membership.createdAt,
      updatedAt: membership.updated_at || membership.updatedAt,
      user: membership.user ? {
        id: membership.user.id,
        nombre: membership.user.nombre,
        email: membership.user.email,
        phone: membership.user.phone
      } : null
    }));

    return res.json({ success: true, data: membersData });
  } catch (error) {
    console.error('Error getting members:', error);
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
  }
};

const inviteMember = async (req, res) => {
  try {
    const { email, role } = req.body;

    if (!email || !role) {
      return res.status(400).json({ 
        error: 'MISSING_FIELDS', 
        message: 'Email y rol son obligatorios' 
      });
    }

    const validRoles = ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ 
        error: 'INVALID_ROLE', 
        message: 'Rol no válido' 
      });
    }

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({ 
        error: 'USER_NOT_FOUND', 
        message: 'El usuario no está registrado en GlowApp' 
      });
    }

    const existingMembership = await Membership.findOne({
      where: {
        user_id: user.id,
        business_profile_id: req.user.businessProfileId
      }
    });

    if (existingMembership) {
      return res.status(400).json({ 
        error: 'MEMBERSHIP_EXISTS', 
        message: 'Este usuario ya tiene una membresía en este establecimiento' 
      });
    }

    const newMembership = await Membership.create({
      user_id: user.id,
      business_profile_id: req.user.businessProfileId,
      role,
      status: 'ACTIVE',
      accepted_at: new Date(),
      created_by_user_id: req.user.id
    });

    return res.status(201).json({ success: true, data: newMembership });
  } catch (error) {
    console.error('Error inviting member:', error);
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
  }
};

const updateRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!role) {
      return res.status(400).json({ 
        error: 'MISSING_ROLE', 
        message: 'Rol es obligatorio' 
      });
    }

    const validRoles = ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ 
        error: 'INVALID_ROLE', 
        message: 'Rol no válido' 
      });
    }

    const membership = await Membership.findOne({
      where: {
        id,
        business_profile_id: req.user.businessProfileId
      }
    });

    if (!membership) {
      return res.status(404).json({ 
        error: 'MEMBERSHIP_NOT_FOUND', 
        message: 'Membresía no encontrada o no pertenece a tu establecimiento' 
      });
    }

    if (membership.role === 'OWNER') {
      return res.status(400).json({
        error: 'CANNOT_MODIFY_OWNER',
        message: 'No se puede modificar el rol del Propietario (OWNER)'
      });
    }

    membership.role = role;
    await membership.save();

    return res.json({ success: true, data: membership });
  } catch (error) {
    console.error('Error updating role:', error);
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
  }
};

const updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ 
        error: 'MISSING_STATUS', 
        message: 'Estado es obligatorio' 
      });
    }

    const validStatuses = ['ACTIVE', 'SUSPENDED', 'REVOKED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        error: 'INVALID_STATUS', 
        message: 'Estado no válido' 
      });
    }

    const membership = await Membership.findOne({
      where: {
        id,
        business_profile_id: req.user.businessProfileId
      }
    });

    if (!membership) {
      return res.status(404).json({ 
        error: 'MEMBERSHIP_NOT_FOUND', 
        message: 'Membresía no encontrada o no pertenece a tu establecimiento' 
      });
    }

    if (membership.role === 'OWNER') {
      return res.status(400).json({
        error: 'CANNOT_SUSPEND_OWNER',
        message: 'No se puede suspender al Propietario (OWNER)'
      });
    }

    membership.status = status;
    await membership.save();

    return res.json({ success: true, data: membership });
  } catch (error) {
    console.error('Error updating status:', error);
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
  }
};

const removeMember = async (req, res) => {
  try {
    const { id } = req.params;

    const membership = await Membership.findOne({
      where: {
        id,
        business_profile_id: req.user.businessProfileId
      }
    });

    if (!membership) {
      return res.status(404).json({ 
        error: 'MEMBERSHIP_NOT_FOUND', 
        message: 'Membresía no encontrada o no pertenece a tu establecimiento' 
      });
    }

    if (membership.role === 'OWNER') {
      return res.status(400).json({
        error: 'CANNOT_REMOVE_OWNER',
        message: 'No se puede eliminar al Propietario (OWNER)'
      });
    }

    await membership.destroy();

    return res.json({ success: true, message: 'Miembro eliminado con éxito' });
  } catch (error) {
    console.error('Error removing member:', error);
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
  }
};

module.exports = {
  getMembers,
  inviteMember,
  updateRole,
  updateStatus,
  removeMember
};

// backend/src/middleware/membership.middleware.js
const { Membership, BusinessProfile } = require('../models');

/**
 * Middleware para validar la pertenencia activa del usuario en un BusinessProfile.
 * Ejecuta después de authMiddleware (req.user debe existir).
 */
const membershipMiddleware = async (req, res, next) => {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Autenticación requerida antes de verificar membresía.' });
  }

  const userRole = (req.user.role || '').toString().toLowerCase();
  const isProviderOrAdmin = userRole === 'provider' || userRole === 'admin' || userRole === 'owner';

  const userId = req.user.id;
  let targetBusinessProfileId = req.user.businessProfileId || 
                                req.headers?.['x-business-profile-id'] || 
                                req.params?.businessProfileId;

  try {
    // Si no se proporcionó un businessProfileId explícito, evaluar las membresías activas del usuario
    if (!targetBusinessProfileId) {
      let activeMemberships = [];
      try {
        activeMemberships = await Membership.findAll({
          where: {
            user_id: userId,
            status: 'ACTIVE'
          },
          include: [{
            model: BusinessProfile,
            as: 'businessProfile',
            attributes: ['id', 'name', 'city']
          }]
        });
      } catch (dbErr) {
        console.warn('⚠️ Warning al buscar membresías:', dbErr.message);
      }

      if (activeMemberships.length === 0) {
        if (isProviderOrAdmin) {
          req.user.businessProfileId = req.user.businessProfileId || null;
          req.user.membershipRole = req.user.membershipRole || 'OWNER';
          return next();
        }
        return res.status(403).json({
          error: 'NO_ACTIVE_MEMBERSHIP',
          message: 'El usuario no tiene ninguna membresía activa.'
        });
      }

      if (activeMemberships.length === 1) {
        // Auto-selección cuando existe exactamente 1 contexto activo
        targetBusinessProfileId = activeMemberships[0].business_profile_id;
        req.membership = activeMemberships[0];
        req.user.businessProfileId = targetBusinessProfileId;
        req.user.membershipRole = activeMemberships[0].role;
        return next();
      }

      // Más de 1 membresía activa requiere selección explícita (Regla de N)
      return res.status(403).json({
        error: 'MULTIPLE_CONTEXTS_REQUIRE_SELECTION',
        message: 'Múltiples contextos activos disponibles. Seleccione uno explícitamente.',
        available_contexts: activeMemberships.map(m => ({
          business_profile_id: m.business_profile_id,
          name: m.businessProfile ? m.businessProfile.name : 'Establecimiento',
          role: m.role
        }))
      });
    }

    // Validar la membresía contra el businessProfileId objetivo
    let membership = null;
    try {
      membership = await Membership.findOne({
        where: {
          user_id: userId,
          business_profile_id: String(targetBusinessProfileId),
          status: 'ACTIVE'
        },
        include: [{
          model: BusinessProfile,
          as: 'businessProfile',
          attributes: ['id', 'name', 'city']
        }]
      });
    } catch (dbErr) {
      console.warn('⚠️ Warning al buscar membresía específica:', dbErr.message);
    }

    if (!membership) {
      if (isProviderOrAdmin) {
        req.user.businessProfileId = targetBusinessProfileId;
        req.user.membershipRole = req.user.membershipRole || 'OWNER';
        return next();
      }
      return res.status(403).json({
        error: 'MEMBERSHIP_INACTIVE_OR_INVALID',
        message: 'No posee una membresía activa en este establecimiento.'
      });
    }

    req.membership = membership;
    req.user.businessProfileId = membership.business_profile_id;
    req.user.membershipRole = membership.role;
    next();
  } catch (err) {
    console.error('❌ Error en membershipMiddleware:', err.message);
    if (isProviderOrAdmin) {
      req.user.membershipRole = req.user.membershipRole || 'OWNER';
      return next();
    }
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: 'Error verificando membresía de usuario.' });
  }
};

module.exports = membershipMiddleware;

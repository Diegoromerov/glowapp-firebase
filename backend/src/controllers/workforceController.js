const { Op } = require('sequelize');
const { validationResult, body } = require('express-validator');
const { User } = require('../models');

/**
 * GET /api/v1/workforce
 * Retrieve a paginated list of workforce members for the current tenant.
 */
exports.getWorkforce = async (req, res) => {
  try {
    const tenantId = req.user.tenant_id; // Assuming authMiddleware adds tenant_id to req.user
    if (!tenantId) {
      return res.status(400).json({ error: 'tenant_id not found in user context' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const where = { tenant_id: tenantId };

    // Optional filters
    if (req.query.worker_type) {
      const types = Array.isArray(req.query.worker_type)
        ? req.query.worker_type
        : [req.query.worker_type];
      // Validate each type against allowed enum values
      const allowed = ['EMPLEADO', 'PRESTADOR_SERVICIO', 'ADMIN_SALON', 'OTRO'];
      const invalid = types.filter(t => !allowed.includes(t));
      if (invalid.length > 0) {
        return res.status(400).json({ error: `Invalid worker_type values: ${invalid.join(', ')}` });
      }
      where.worker_type = { [Op.in]: types };
    }

    if (req.query.search) {
      const searchTerm = `%${req.query.search}%`;
      where[Op.or] = [
        { nombre: { [Op.like]: searchTerm } },
        { email: { [Op.like]: searchTerm } }
      ];
    }

    const { count, rows } = await User.findAndCountAll({
      where,
      attributes: ['id', 'nombre', 'email', 'worker_type', 'rol', 'is_active', 'created_at'],
      limit,
      offset,
      order: [['created_at', 'DESC']]
    });

    res.json({
      data: rows.map(user => ({
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        worker_type: user.worker_type,
        rol: user.rol,
        is_active: user.is_active,
        created_at: user.created_at
      })),
      meta: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Error in getWorkforce:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * GET /api/v1/workforce/:id
 * Retrieve a single workforce member by ID.
 */
exports.getWorkforceById = async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) {
      return res.status(400).json({ error: 'tenant_id not found in user context' });
    }

    const user = await User.findOne({
      where: { id: req.params.id, tenant_id: tenantId },
      attributes: ['id', 'nombre', 'email', 'worker_type', 'rol', 'is_active', 'created_at']
    });

    if (!user) {
      return res.status(404).json({ error: 'Workforce member not found' });
    }

    res.json({
      data: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        worker_type: user.worker_type,
        rol: user.rol,
        is_active: user.is_active,
        created_at: user.created_at
      }
    });
  } catch (error) {
    console.error('Error in getWorkforceById:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * PATCH /api/v1/workforce/:id
 * Update the operational classification (worker_type) and/or is_active.
 */
exports.updateWorkforce = [
  // Validation middleware
  [
    body('worker_type')
      .optional()
      .isIn(['EMPLEADO', 'PRESTADOR_SERVICIO', 'ADMIN_SALON', 'OTRO'])
      .withMessage('worker_type must be one of EMPLEADO, PRESTADOR_SERVICIO, ADMIN_SALON, OTRO'),
    body('is_active').optional().isBoolean()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const tenantId = req.user.tenant_id;
      if (!tenantId) {
        return res.status(400).json({ error: 'tenant_id not found in user context' });
      }

      const updates = {};
      if (req.body.worker_type !== undefined) {
        updates.worker_type = req.body.worker_type;
      }
      if (req.body.is_active !== undefined) {
        updates.is_active = req.body.is_active;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      const [updatedCount] = await User.update(updates, {
        where: { id: req.params.id, tenant_id: tenantId }
      });

      if (updatedCount === 0) {
        return res.status(404).json({ error: 'Workforce member not found' });
      }

      // Fetch updated user to return
      const updatedUser = await User.findOne({
        where: { id: req.params.id, tenant_id: tenantId },
        attributes: ['id', 'nombre', 'email', 'worker_type', 'rol', 'is_active', 'created_at']
      });

      res.json({
        data: {
          id: updatedUser.id,
          nombre: updatedUser.nombre,
          email: updatedUser.email,
          worker_type: updatedUser.worker_type,
          rol: updatedUser.rol,
          is_active: updatedUser.is_active,
          created_at: updatedUser.created_at
        }
      });
    } catch (error) {
      console.error('Error in updateWorkforce:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
];

/**
 * DELETE /api/v1/workforce/:id
 * Deactivate a workforce member (soft delete via is_active = false).
 */
exports.deactivateWorkforce = async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) {
      return res.status(400).json({ error: 'tenant_id not found in user context' });
    }

    const [updatedCount] = await User.update(
      { is_active: false },
      { where: { id: req.params.id, tenant_id: tenantId } }
    );

    if (updatedCount === 0) {
      return res.status(404).json({ error: 'Workforce member not found' });
    }

    res.status(204).send(); // No Content
  } catch (error) {
    console.error('Error in deactivateWorkforce:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
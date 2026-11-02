// backend/src/controllers/serviceController.js
const { pool } = require('../config/db');
const { Op } = require('sequelize');
const Service = require('../models/Service');

/**
 * 💅 SERVICE CONTROLLER (GLOWAPP SAAS & PROVIDER ENGINE)
 * Handles service CRUD with strict multi-tenant isolation (Anti-Tenant-Leakage / Anti-IDOR).
 */

// Helper to sanitize req.user context
const getSanitizedAuthContext = (req) => {
  const rawBpId = req.user?.businessProfileId;
  const businessProfileId = (rawBpId && String(rawBpId).trim() !== 'null' && String(rawBpId).trim() !== 'undefined' && String(rawBpId).trim() !== '')
    ? String(rawBpId).trim()
    : null;
  const providerId = req.user?.id ? (isNaN(parseInt(req.user.id)) ? req.user.id : parseInt(req.user.id)) : null;
  return { businessProfileId, providerId };
};

// Helper to build tenant isolation query condition for Sequelize
const buildTenantWhere = (req, extraWhere = {}) => {
  const { businessProfileId, providerId } = getSanitizedAuthContext(req);

  if (businessProfileId) {
    return {
      [Op.and]: [
        extraWhere,
        {
          [Op.or]: [
            { business_profile_id: businessProfileId },
            { provider_id: providerId }
          ]
        }
      ]
    };
  }

  return {
    [Op.and]: [
      extraWhere,
      { provider_id: providerId }
    ]
  };
};

// GET /api/services/provider → Lista servicios del establecimiento/provider activo
exports.getProviderServices = async (req, res) => {
  try {
    const { businessProfileId, providerId } = getSanitizedAuthContext(req);

    if (!businessProfileId && !providerId) {
      return res.status(403).json({ 
        error: 'FORBIDDEN', 
        message: 'No hay un contexto de negocio activo ni usuario autenticado.' 
      });
    }

    let services = [];
    try {
      if (businessProfileId) {
        const queryRes = await pool.query(
          'SELECT id, provider_id, business_profile_id, name, description, price, duration_minutes, category, is_active FROM services WHERE business_profile_id = $1 OR provider_id = $2 ORDER BY name ASC',
          [businessProfileId, providerId]
        );
        services = queryRes.rows;
      } else {
        const queryRes = await pool.query(
          'SELECT id, provider_id, business_profile_id, name, description, price, duration_minutes, category, is_active FROM services WHERE provider_id = $1 ORDER BY name ASC',
          [providerId]
        );
        services = queryRes.rows;
      }
    } catch (dbErr) {
      console.warn('⚠️ Fallback pg pool query en GET /api/services/provider:', dbErr.message);
      if (providerId) {
        try {
          const queryRes = await pool.query(
            'SELECT id, provider_id, business_profile_id, name, description, price, duration_minutes, category, is_active FROM services WHERE provider_id = $1 ORDER BY name ASC',
            [providerId]
          );
          services = queryRes.rows;
        } catch (err2) {
          console.warn('⚠️ Final fallback 0 servicios:', err2.message);
          services = [];
        }
      }
    }

    const formattedServices = services.map(service => ({
      id: service.id,
      name: service.name,
      description: service.description || '',
      price: parseFloat(service.price) || 0.0,
      duration_minutes: parseInt(service.duration_minutes) || 30,
      category: service.category || '',
      is_active: service.is_active !== false,
      business_profile_id: service.business_profile_id
    }));

    res.json({ success: true, count: formattedServices.length, data: formattedServices });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/services/provider:', { message: error.message });
    res.status(500).json({ error: 'Error interno al obtener servicios' });
  }
};

// POST /api/services → Crea servicio asociado al establecimiento activo
exports.createService = async (req, res) => {
  try {
    const { businessProfileId, providerId } = getSanitizedAuthContext(req);

    const { name, description, price, duration_minutes, category, is_active } = req.body;
    if (!name || price === undefined || !duration_minutes) {
      return res.status(400).json({ error: 'Faltan campos obligatorios (nombre, precio, duración)' });
    }

    const parsedPrice = parseFloat(price);
    const parsedDuration = parseInt(duration_minutes);
    const isActiveVal = is_active !== false;

    if (isNaN(parsedPrice) || parsedPrice < 0) {
      return res.status(400).json({ error: 'Precio inválido' });
    }
    if (isNaN(parsedDuration) || parsedDuration <= 0) {
      return res.status(400).json({ error: 'Duración inválida' });
    }

    let serviceData = null;
    try {
      const insertQ = `
        INSERT INTO services (provider_id, business_profile_id, name, description, price, duration_minutes, category, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, provider_id, business_profile_id, name, description, price, duration_minutes, category, is_active;
      `;
      const insertRes = await pool.query(insertQ, [
        providerId,
        businessProfileId,
        name,
        description || null,
        parsedPrice,
        parsedDuration,
        category || null,
        isActiveVal
      ]);
      serviceData = insertRes.rows[0];
    } catch (dbErr) {
      console.warn('⚠️ Standard insert in createService failed, attempting resilient fallback insert:', dbErr.message);
      try {
        const fallbackInsertQ = `
          INSERT INTO services (provider_id, name, description, price, duration_minutes, category, is_active)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id, provider_id, name, description, price, duration_minutes, category, is_active;
        `;
        const insertRes = await pool.query(fallbackInsertQ, [
          providerId,
          name,
          description || null,
          parsedPrice,
          parsedDuration,
          category || null,
          isActiveVal
        ]);
        serviceData = { ...insertRes.rows[0], business_profile_id: null };
      } catch (dbErr2) {
        console.error('❌ Resilient fallback insert in createService failed:', dbErr2.message);
        throw dbErr2;
      }
    }

    res.status(201).json({
      success: true,
      message: 'Servicio creado exitosamente',
      data: {
        id: serviceData.id,
        provider_id: serviceData.provider_id,
        business_profile_id: serviceData.business_profile_id || null,
        name: serviceData.name,
        description: serviceData.description,
        price: parseFloat(serviceData.price),
        duration_minutes: parseInt(serviceData.duration_minutes),
        category: serviceData.category,
        is_active: serviceData.is_active
      }
    });
  } catch (error) {
    console.error('❌ ERROR EN POST /api/services:', { message: error.message });
    res.status(500).json({ error: 'Error interno al crear el servicio' });
  }
};

// PUT /api/services/:id → Actualiza servicio (IDOR & Multi-tenant Protected)
exports.updateService = async (req, res) => {
  try {
    const serviceId = req.params.id;
    const { businessProfileId, providerId } = getSanitizedAuthContext(req);
    const { name, description, price, duration_minutes, category, is_active } = req.body;

    if (!name || price === undefined || !duration_minutes) {
      return res.status(400).json({ error: 'Faltan campos obligatorios (nombre, precio, duración)' });
    }

    const parsedPrice = parseFloat(price);
    const parsedDuration = parseInt(duration_minutes);

    if (isNaN(parsedPrice) || parsedPrice < 0) {
      return res.status(400).json({ error: 'Precio inválido' });
    }
    if (isNaN(parsedDuration) || parsedDuration <= 0) {
      return res.status(400).json({ error: 'Duración inválida' });
    }

    let updatedService = null;
    try {
      let updateQ, params;
      if (businessProfileId) {
        updateQ = `
          UPDATE services 
          SET name = $1, description = $2, price = $3, duration_minutes = $4, category = $5, is_active = $6
          WHERE id = $7 AND (provider_id = $8 OR business_profile_id = $9)
          RETURNING id, provider_id, business_profile_id, name, description, price, duration_minutes, category, is_active;
        `;
        params = [name, description || null, parsedPrice, parsedDuration, category || null, is_active !== false, serviceId, providerId, businessProfileId];
      } else {
        updateQ = `
          UPDATE services 
          SET name = $1, description = $2, price = $3, duration_minutes = $4, category = $5, is_active = $6
          WHERE id = $7 AND provider_id = $8
          RETURNING id, provider_id, business_profile_id, name, description, price, duration_minutes, category, is_active;
        `;
        params = [name, description || null, parsedPrice, parsedDuration, category || null, is_active !== false, serviceId, providerId];
      }
      const updateRes = await pool.query(updateQ, params);

      if (updateRes.rows.length === 0) {
        return res.status(404).json({ 
          error: 'SERVICE_NOT_FOUND', 
          message: 'El servicio no existe o no tienes acceso a él.' 
        });
      }
      updatedService = updateRes.rows[0];
    } catch (dbErr) {
      console.warn('⚠️ Fallback a Sequelize en updateService:', dbErr.message);
      const whereClause = buildTenantWhere(req, { id: serviceId });
      const service = await Service.findOne({ where: whereClause });
      if (!service) {
        return res.status(404).json({ 
          error: 'SERVICE_NOT_FOUND', 
          message: 'El servicio no existe o no tienes acceso a él.' 
        });
      }
      service.name = name;
      service.description = description || null;
      service.price = parsedPrice;
      service.duration_minutes = parsedDuration;
      service.category = category || null;
      if (is_active !== undefined) {
        service.is_active = is_active !== false;
      }
      await service.save();
      updatedService = service.toJSON();
    }

    res.json({
      success: true,
      message: 'Servicio actualizado exitosamente',
      data: {
        id: updatedService.id,
        provider_id: updatedService.provider_id,
        business_profile_id: updatedService.business_profile_id,
        name: updatedService.name,
        description: updatedService.description,
        price: parseFloat(updatedService.price),
        duration_minutes: parseInt(updatedService.duration_minutes),
        category: updatedService.category,
        is_active: updatedService.is_active
      }
    });
  } catch (error) {
    console.error('❌ ERROR EN PUT /api/services/:id:', { message: error.message });
    res.status(500).json({ error: 'Error interno al actualizar el servicio' });
  }
};

// DELETE /api/services/:id → Elimina / Desactiva servicio (IDOR & Multi-tenant Protected)
exports.deleteService = async (req, res) => {
  try {
    const serviceId = req.params.id;
    const { businessProfileId, providerId } = getSanitizedAuthContext(req);

    try {
      let deleteQ, params;
      if (businessProfileId) {
        deleteQ = `
          UPDATE services 
          SET is_active = false
          WHERE id = $1 AND (provider_id = $2 OR business_profile_id = $3)
          RETURNING id, name, is_active;
        `;
        params = [serviceId, providerId, businessProfileId];
      } else {
        deleteQ = `
          UPDATE services 
          SET is_active = false
          WHERE id = $1 AND provider_id = $2
          RETURNING id, name, is_active;
        `;
        params = [serviceId, providerId];
      }
      const deleteRes = await pool.query(deleteQ, params);

      if (deleteRes.rows.length === 0) {
        return res.status(404).json({ 
          error: 'SERVICE_NOT_FOUND', 
          message: 'El servicio no existe o no tienes acceso a él.' 
        });
      }

      return res.json({
        success: true,
        message: 'Servicio desactivado exitosamente',
        data: {
          id: deleteRes.rows[0].id,
          name: deleteRes.rows[0].name,
          is_active: deleteRes.rows[0].is_active
        }
      });
    } catch (dbErr) {
      console.warn('⚠️ Fallback a Sequelize en deleteService:', dbErr.message);
      const whereClause = buildTenantWhere(req, { id: serviceId });
      const service = await Service.findOne({ where: whereClause });

      if (!service) {
        return res.status(404).json({ 
          error: 'SERVICE_NOT_FOUND', 
          message: 'El servicio no existe o no tienes acceso a él.' 
        });
      }

      service.is_active = false;
      await service.save();

      return res.json({
        success: true,
        message: 'Servicio desactivado exitosamente',
        data: {
          id: service.id,
          name: service.name,
          is_active: service.is_active
        }
      });
    }
  } catch (error) {
    console.error('❌ ERROR EN DELETE /api/services/:id:', { message: error.message });
    res.status(500).json({ error: 'Error interno al desactivar el servicio' });
  }
};


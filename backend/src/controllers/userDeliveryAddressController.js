const { pool } = require('../config/db');

// GET /api/users/delivery-addresses - Listar direcciones del usuario
exports.getDeliveryAddresses = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const result = await pool.query(
      `SELECT id, tipo_via, numero_principal, letra_principal, numero_secundario, 
              letra_secundaria, complemento, barrio, ciudad, departamento, 
              codigo_postal, referencia, direccion_formateada, alias, es_default, activo
       FROM user_delivery_addresses
       WHERE user_id = $1 AND activo = TRUE
       ORDER BY es_default DESC, creado_en DESC`,
      [userId]
    );
    
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('❌ ERROR GET /api/users/delivery-addresses:', error.message);
    res.status(500).json({ error: 'Error al obtener direcciones de entrega' });
  }
};

// GET /api/users/delivery-addresses/default - Obtener dirección default del usuario
exports.getDefaultDeliveryAddress = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const result = await pool.query(
      `SELECT id, tipo_via, numero_principal, letra_principal, numero_secundario, 
              letra_secundaria, complemento, barrio, ciudad, departamento, 
              codigo_postal, referencia, direccion_formateada, alias, es_default
       FROM user_delivery_addresses
       WHERE user_id = $1 AND activo = TRUE AND es_default = TRUE
       LIMIT 1`,
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.json({ success: true, data: null });
    }
    
    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('❌ ERROR GET /api/users/delivery-addresses/default:', error.message);
    res.status(500).json({ error: 'Error al obtener dirección de entrega por defecto' });
  }
};

// POST /api/users/delivery-addresses - Crear nueva dirección de entrega
exports.createDeliveryAddress = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      tipo_via,
      numero_principal,
      letra_principal,
      numero_secundario,
      letra_secundaria,
      complemento,
      barrio,
      ciudad,
      departamento,
      codigo_postal,
      referencia,
      alias,
      es_default
    } = req.body;
    
    // Validaciones obligatorias
    if (!tipo_via || !numero_principal || !ciudad || !departamento) {
      return res.status(400).json({ 
        error: 'Campos obligatorios: tipo_via, numero_principal, ciudad, departamento' 
      });
    }
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Si se marca como default, quitar default de las otras
      if (es_default) {
        await client.query(
          `UPDATE user_delivery_addresses SET es_default = FALSE WHERE user_id = $1`,
          [userId]
        );
      }
      
      const result = await client.query(
        `INSERT INTO user_delivery_addresses 
         (user_id, tipo_via, numero_principal, letra_principal, numero_secundario, 
          letra_secundaria, complemento, barrio, ciudad, departamento, 
          codigo_postal, referencia, alias, es_default)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING id, direccion_formateada, alias, es_default`,
        [
          userId,
          tipo_via,
          numero_principal,
          letra_principal || null,
          numero_secundario || null,
          letra_secundaria || null,
          complemento || null,
          barrio || null,
          ciudad,
          departamento,
          codigo_postal || null,
          referencia || null,
          alias || null,
          es_default || false
        ]
      );
      
      await client.query('COMMIT');
      
      res.status(201).json({
        success: true,
        data: result.rows[0],
        message: 'Dirección de entrega creada correctamente'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ ERROR POST /api/users/delivery-addresses:', error.message);
    if (error.code === '23505') { // unique violation - ya hay default
      return res.status(400).json({ error: 'Ya existe una dirección por defecto. Desmárcala antes de crear otra.' });
    }
    res.status(500).json({ error: 'Error al crear dirección de entrega' });
  }
};

// PATCH /api/users/delivery-addresses/:id - Actualizar dirección de entrega
exports.updateDeliveryAddress = async (req, res) => {
  try {
    const userId = req.user.id;
    const addressId = req.params.id;
    const {
      tipo_via,
      numero_principal,
      letra_principal,
      numero_secundario,
      letra_secundaria,
      complemento,
      barrio,
      ciudad,
      departamento,
      codigo_postal,
      referencia,
      alias,
      es_default,
      activo
    } = req.body;
    
    // Verificar que la dirección pertenece al usuario
    const checkRes = await pool.query(
      'SELECT id FROM user_delivery_addresses WHERE id = $1 AND user_id = $2',
      [addressId, userId]
    );
    
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ error: 'Dirección no encontrada' });
    }
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Si se marca como default, quitar default de las otras
      if (es_default) {
        await client.query(
          `UPDATE user_delivery_addresses SET es_default = FALSE WHERE user_id = $1 AND id != $2`,
          [userId, addressId]
        );
      }
      
      // Construir query dinámica
      const updates = [];
      const values = [addressId, userId];
      let paramIndex = 3;
      
      const fields = {
        tipo_via, numero_principal, letra_principal, numero_secundario,
        letra_secundaria, complemento, barrio, ciudad, departamento,
        codigo_postal, referencia, alias, es_default, activo
      };
      
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) {
          updates.push(`${key} = $${paramIndex++}`);
          values.push(value);
        }
      }
      
      if (updates.length === 0) {
        return res.status(400).json({ error: 'No se proporcionaron campos para actualizar' });
      }
      
      updates.push('actualizado_en = NOW()');
      
      const query = `
        UPDATE user_delivery_addresses
        SET ${updates.join(', ')}
        WHERE id = $1 AND user_id = $2
        RETURNING id, direccion_formateada, alias, es_default
      `;
      
      const result = await client.query(query, values);
      
      await client.query('COMMIT');
      
      res.json({
        success: true,
        data: result.rows[0],
        message: 'Dirección de entrega actualizada correctamente'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ ERROR PATCH /api/users/delivery-addresses/:id:', error.message);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Ya existe una dirección por defecto. Desmárcala antes de actualizar.' });
    }
    res.status(500).json({ error: 'Error al actualizar dirección de entrega' });
  }
};

// DELETE /api/users/delivery-addresses/:id - Eliminar (soft delete) dirección de entrega
exports.deleteDeliveryAddress = async (req, res) => {
  try {
    const userId = req.user.id;
    const addressId = req.params.id;
    
    // Verificar que la dirección pertenece al usuario
    const checkRes = await pool.query(
      'SELECT id, es_default FROM user_delivery_addresses WHERE id = $1 AND user_id = $2',
      [addressId, userId]
    );
    
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ error: 'Dirección no encontrada' });
    }
    
    const wasDefault = checkRes.rows[0].es_default;
    
    // Soft delete
    await pool.query(
      `UPDATE user_delivery_addresses SET activo = FALSE, actualizado_en = NOW() WHERE id = $1`,
      [addressId]
    );
    
    // Si era la default, promover otra a default si existe
    if (wasDefault) {
      await pool.query(
        `UPDATE user_delivery_addresses SET es_default = TRUE 
         WHERE user_id = $1 AND activo = TRUE 
         ORDER BY creado_en DESC LIMIT 1`,
        [userId]
      );
    }
    
    res.json({
      success: true,
      message: 'Dirección de entrega eliminada correctamente'
    });
  } catch (error) {
    console.error('❌ ERROR DELETE /api/users/delivery-addresses/:id:', error.message);
    res.status(500).json({ error: 'Error al eliminar dirección de entrega' });
  }
};

// PATCH /api/users/delivery-addresses/:id/set-default - Marcar como dirección por defecto
exports.setDefaultDeliveryAddress = async (req, res) => {
  try {
    const userId = req.user.id;
    const addressId = req.params.id;
    
    // Verificar que la dirección pertenece al usuario
    const checkRes = await pool.query(
      'SELECT id FROM user_delivery_addresses WHERE id = $1 AND user_id = $2 AND activo = TRUE',
      [addressId, userId]
    );
    
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ error: 'Dirección no encontrada o inactiva' });
    }
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Quitar default de todas
      await client.query(
        `UPDATE user_delivery_addresses SET es_default = FALSE WHERE user_id = $1`,
        [userId]
      );
      
      // Poner default en la seleccionada
      await client.query(
        `UPDATE user_delivery_addresses SET es_default = TRUE, actualizado_en = NOW() WHERE id = $1`,
        [addressId]
      );
      
      await client.query('COMMIT');
      
      res.json({
        success: true,
        message: 'Dirección establecida como predeterminada'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ ERROR PATCH /api/users/delivery-addresses/:id/set-default:', error.message);
    res.status(500).json({ error: 'Error al establecer dirección por defecto' });
  }
};
// backend/src/controllers/userPreferencesController.js
const { pool } = require('../config/db');

// GET /api/users/preferences - Obtener preferencias del usuario autenticado
exports.getPreferences = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // UPSERT-like: obtener o crear fila con defaults
    const result = await pool.query(
      `INSERT INTO user_preferences (user_id, telemetry_enabled, push_enabled, marketing_enabled)
       VALUES ($1, true, true, false)
       ON CONFLICT (user_id) DO NOTHING
       RETURNING *`,
      [userId]
    );
    
    let preferences;
    if (result.rows.length > 0) {
      preferences = result.rows[0];
    } else {
      // Ya existía, obtenerla
      const existing = await pool.query(
        'SELECT * FROM user_preferences WHERE user_id = $1',
        [userId]
      );
      preferences = existing.rows[0];
    }
    
    res.json({
      success: true,
      data: {
        telemetry_enabled: preferences.telemetry_enabled,
        push_enabled: preferences.push_enabled,
        marketing_enabled: preferences.marketing_enabled
      }
    });
  } catch (error) {
    console.error('❌ ERROR GET /api/users/preferences:', error.message);
    res.status(500).json({ error: 'Error al obtener preferencias' });
  }
};

// PATCH /api/users/preferences - Actualizar preferencias (parcial)
exports.updatePreferences = async (req, res) => {
  try {
    const userId = req.user.id;
    const { telemetry_enabled, push_enabled, marketing_enabled } = req.body;
    
    // Construir query dinámica solo con campos enviados
    const updates = [];
    const values = [userId];
    let paramIndex = 2;
    
    if (typeof telemetry_enabled === 'boolean') {
      updates.push(`telemetry_enabled = $${paramIndex++}`);
      values.push(telemetry_enabled);
    }
    if (typeof push_enabled === 'boolean') {
      updates.push(`push_enabled = $${paramIndex++}`);
      values.push(push_enabled);
    }
    if (typeof marketing_enabled === 'boolean') {
      updates.push(`marketing_enabled = $${paramIndex++}`);
      values.push(marketing_enabled);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No se proporcionaron campos válidos para actualizar' });
    }
    
    updates.push(`updated_at = NOW()`);
    
    const query = `
      INSERT INTO user_preferences (user_id, telemetry_enabled, push_enabled, marketing_enabled)
      VALUES ($1, true, true, false)
      ON CONFLICT (user_id) DO UPDATE SET
        ${updates.join(', ')}
      RETURNING *
    `;
    
    const result = await pool.query(query, values);
    const preferences = result.rows[0];
    
    res.json({
      success: true,
      data: {
        telemetry_enabled: preferences.telemetry_enabled,
        push_enabled: preferences.push_enabled,
        marketing_enabled: preferences.marketing_enabled
      },
      message: 'Preferencias actualizadas correctamente'
    });
  } catch (error) {
    console.error('❌ ERROR PATCH /api/users/preferences:', error.message);
    res.status(500).json({ error: 'Error al actualizar preferencias' });
  }
};
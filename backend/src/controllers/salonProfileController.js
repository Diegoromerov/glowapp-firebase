const { pool } = require('../config/db');
const tenantRouting = require('../config/tenantRouting');

const PROFILE_FIELDS = Object.freeze({
  // business_profiles.name has VARCHAR(150); keep both representations valid.
  nombre_salon: { column: 'nombre_salon', max: 150 },
  nit: { column: 'nit', max: 50 },
  direccion: { column: 'direccion', max: 500 },
  telefono: { column: 'telefono', max: 50 },
  ciudad: { column: 'ciudad', max: 100 },
});

function validateSchedule(schedule) {
  if (schedule === null) return null;
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) {
    throw new Error('El horario debe ser un objeto por días de la semana.');
  }
  const days = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
  const normalized = {};
  for (const day of days) {
    const value = schedule[day];
    if (value === undefined) continue;
    if (!value || typeof value !== 'object' || typeof value.open !== 'boolean') {
      throw new Error(`El horario de ${day} no es válido.`);
    }
    if (!value.open) {
      normalized[day] = { open: false };
      continue;
    }
    const validTime = (time) => typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
    if (!validTime(value.start) || !validTime(value.end) || value.start >= value.end) {
      throw new Error(`Indica una hora de apertura y cierre válidas para ${day}.`);
    }
    normalized[day] = { open: true, start: value.start, end: value.end };
  }
  if (!Object.keys(normalized).length) throw new Error('Agrega al menos un día al horario.');
  return normalized;
}

exports.getSalonProfile = async (req, res) => {
  try {
    const result = await tenantRouting.runAsSystem({ pool }, (client) => client.query(
      `SELECT id, nombre_salon, nit, direccion, telefono, ciudad, latitude,
              longitude, location_public, horario_atencion, updated_at
         FROM salones WHERE id = $1`,
      [req.salonId]
    ));
    if (!result.rows.length) return res.status(404).json({ error: 'No encontramos el salón.' });
    return res.json({ success: true, salon: result.rows[0] });
  } catch (error) {
    console.error('Error al consultar el perfil del salón:', error.message);
    return res.status(500).json({ error: 'No pudimos cargar los datos del salón.' });
  }
};

exports.updateSalonProfile = async (req, res) => {
  const salonId = req.salonId;
  const updates = [];
  const params = [salonId];
  const body = req.body || {};

  try {
    for (const [field, config] of Object.entries(PROFILE_FIELDS)) {
      if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
      if (body[field] !== null && typeof body[field] !== 'string') {
        return res.status(400).json({ error: `${field} debe ser texto.` });
      }
      const value = body[field] === null ? null : String(body[field]).trim();
      if (value !== null && value.length > config.max) {
        return res.status(400).json({ error: `${field} supera el máximo de ${config.max} caracteres.` });
      }
      if (field === 'nombre_salon' && !value) {
        return res.status(400).json({ error: 'El nombre del salón no puede quedar vacío.' });
      }
      params.push(value || null);
      updates.push(`${config.column} = $${params.length}`);
    }

    let schedule = undefined;
    if (Object.prototype.hasOwnProperty.call(body, 'horario_atencion')) {
      try {
        schedule = validateSchedule(body.horario_atencion);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
      params.push(schedule === null ? null : JSON.stringify(schedule));
      updates.push(`horario_atencion = $${params.length}::jsonb`);
    }

    if (!updates.length) return res.status(400).json({ error: 'No se recibieron datos para actualizar.' });
    updates.push('updated_at = CURRENT_TIMESTAMP');

    const salon = await tenantRouting.runAsSystem({ pool }, async (client) => {
      const result = await client.query(
        `UPDATE salones
            SET ${updates.join(', ')}
          WHERE id = $1
          RETURNING id, business_profile_id, nombre_salon, nit, direccion,
                    telefono, ciudad, latitude, longitude, location_public,
                    horario_atencion, updated_at`,
        params
      );
      if (!result.rows.length) return null;

      // Mantener nombre y ciudad SaaS alineados dentro de la misma transacción.
      const current = result.rows[0];
      const profileUpdates = [];
      const profileParams = [current.business_profile_id];
      if (Object.prototype.hasOwnProperty.call(body, 'nombre_salon')) {
        profileParams.push(current.nombre_salon);
        profileUpdates.push(`name = $${profileParams.length}`);
      }
      if (Object.prototype.hasOwnProperty.call(body, 'ciudad')) {
        profileParams.push(current.ciudad);
        profileUpdates.push(`city = $${profileParams.length}`);
      }
      if (profileUpdates.length && current.business_profile_id) {
        await client.query(
          `UPDATE business_profiles SET ${profileUpdates.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1`,
          profileParams
        );
      }
      return current;
    });
    if (!salon) return res.status(404).json({ error: 'No encontramos el salón.' });
    return res.json({ success: true, salon });
  } catch (error) {
    console.error('Error al actualizar el perfil del salón:', error.message);
    return res.status(500).json({ error: 'No pudimos guardar los datos del salón.' });
  }
};

exports.validateSchedule = validateSchedule;

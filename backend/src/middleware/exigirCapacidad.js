'use strict';

/**
 * Puerta por capacidad (D-GL-031).
 *
 * `exigirCapacidad('COBRAR')` bloquea con 409 y un mensaje que dice qué hacer,
 * no sólo "prohibido". Se apoya en `capacidadesProveedor`, que es el único lugar
 * donde se decide qué puede hacer una cuenta.
 *
 * Consulta la base en cada petición a propósito: el estado cambia cuando el
 * equipo aprueba documentos, y una caché vieja bloquearía a alguien ya habilitado
 * (o al revés, lo dejaría cobrar).
 */

const { pool } = require('../config/db');
const { calcularCapacidades, motivoBloqueo } = require('../services/capacidadesProveedor');

function exigirCapacidad(capacidad) {
  if (typeof capacidad !== 'string' || capacidad === '') {
    throw new Error('exigirCapacidad requiere el nombre de una capacidad.');
  }

  return async function middlewareCapacidad(req, res, next) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ error: 'No autenticado.' });
      }

      const { rows } = await pool.query(
        'SELECT estado_operativo, rol FROM usuarios WHERE id = $1',
        [req.user.id]
      );

      if (!rows.length) {
        return res.status(404).json({ error: 'Usuario no encontrado.' });
      }

      const capacidades = calcularCapacidades({
        estadoOperativo: rows[0].estado_operativo,
        rol: rows[0].rol || req.user.role,
      });

      if (capacidades.puede(capacidad)) return next();

      const motivo = motivoBloqueo(capacidades.estado) || {
        mensaje: 'Tu cuenta no tiene esta capacidad habilitada.',
        siguiente_paso: 'CONTACTAR_SOPORTE',
      };

      return res.status(409).json({
        error: 'CAPACIDAD_DENEGADA',
        capacidad,
        estado_operativo: capacidades.estado,
        mensaje: motivo.mensaje,
        siguiente_paso: motivo.siguiente_paso,
      });
    } catch (err) {
      return next(err);
    }
  };
}

/** Carga las capacidades del usuario en `req.capacidades` (para pantallas). */
async function cargarCapacidades(req, res, next) {
  try {
    if (!req.user || !req.user.id) return next();
    const { rows } = await pool.query(
      'SELECT estado_operativo, rol FROM usuarios WHERE id = $1',
      [req.user.id]
    );
    if (rows.length) {
      req.capacidades = calcularCapacidades({
        estadoOperativo: rows[0].estado_operativo,
        rol: rows[0].rol || req.user.role,
      });
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { exigirCapacidad, cargarCapacidades };

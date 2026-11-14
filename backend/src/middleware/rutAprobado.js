'use strict';

/**
 * Publicar servicios exige el RUT aprobado (D-GL-030).
 *
 * El gate arranca en modo `warn`: los prestadores que ya están operando no
 * pierden la posibilidad de editar su catálogo el día del despliegue, pero cada
 * intento queda registrado. Cuando todos hayan subido su RUT, se pone
 * `RUT_GATE_MODE=block` y el bloqueo pasa a ser efectivo.
 *
 * Se consulta la base en cada petición y no se cachea: el estado cambia cuando
 * el equipo aprueba, y un catálogo bloqueado por una caché vieja es peor que una
 * consulta por escritura (son pocas y ya vienen con auth y membership).
 */

const { pool } = require('../config/db');
const { ESTADOS } = require('../services/fiscalRevision');

const MODOS = ['warn', 'block'];

function modoActual() {
  const modo = String(process.env.RUT_GATE_MODE || 'warn').toLowerCase();
  return MODOS.includes(modo) ? modo : 'warn';
}

async function exigirRutAprobado(req, res, next) {
  try {
    const { rows } = await pool.query(
      'SELECT revision_estado, rut_numero FROM usuarios WHERE id = $1',
      [req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    const estado = rows[0].revision_estado || ESTADOS.SIN_ENVIAR;
    if (estado === ESTADOS.APROBADA) return next();

    const modo = modoActual();
    if (modo === 'warn') {
      console.warn(
        `[RUT GATE:warn] prestador ${req.user.id} sin RUT aprobado (${estado}) — ${req.method} ${req.originalUrl}`
      );
      return next();
    }

    return res.status(409).json({
      error: 'RUT_NO_APROBADO',
      estado_revision: estado,
      detalle:
        'Para publicar o editar servicios necesitas el RUT aprobado. Súbelo desde tu perfil y el equipo lo revisa.',
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { exigirRutAprobado, modoActual };

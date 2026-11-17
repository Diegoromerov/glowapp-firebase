'use strict';

/**
 * Publicar servicios exige el RUT aprobado (D-GL-030).
 *
 * El gate arranca en modo `warn`: los prestadores que ya están operando no
 * pierden la posibilidad de editar su catálogo el día del despliegue, pero cada
 * intento queda registrado. Cuando todos hayan subido su RUT, se pone
 * `RUT_GATE_MODE=block` y el bloqueo pasa a ser efectivo.
 *
 * IMPORTANTE — por qué mira el cuerpo de la petición: el controlador aplica
 * `is_active !== false`, así que **crear un servicio es publicarlo** salvo que
 * venga explícitamente en borrador. Bloquear la creación entera dejaba al
 * proveedor en Modo Exploración (D-GL-031) sin poder armar su catálogo, que es
 * justo lo que ese modo permite. La puerta se abre para `is_active: false` y se
 * cierra para todo lo que queda visible en la app cliente.
 *
 * Se consulta la base en cada publicación y no se cachea: el estado cambia
 * cuando el equipo aprueba, y un catálogo bloqueado por una caché vieja es peor
 * que una consulta por escritura (son pocas y ya vienen con auth y membership).
 */

const { pool } = require('../config/db');
const { ESTADOS } = require('../services/fiscalRevision');

const MODOS = ['warn', 'block'];

function modoActual() {
  const modo = String(process.env.RUT_GATE_MODE || 'warn').toLowerCase();
  return MODOS.includes(modo) ? modo : 'warn';
}

/**
 * ¿La petición deja el servicio publicado?
 * Sin `is_active` en el cuerpo, el controlador aplica `true`: se publica.
 */
function publicaServicio(body) {
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'is_active')) return true;
  return body.is_active !== false;
}

async function exigirRutAprobado(req, res, next) {
  try {
    if (!publicaServicio(req.body)) return next();

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
        'Para publicar servicios necesitas el RUT aprobado. Puedes seguir creando borradores mientras el equipo lo revisa.',
      // La app puede reintentar la misma llamada guardando el servicio en borrador.
      alternativa: { is_active: false },
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { exigirRutAprobado, modoActual, publicaServicio };

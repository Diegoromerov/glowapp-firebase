'use strict';

/**
 * Vitrina pública del proveedor (D-GL-031, T-077).
 *
 * El proveedor en Modo Exploración comparte un enlace con su perfil: ve cómo se
 * vería, y sus clientas pueden verlo **sin poder reservar**. La vitrina no es un
 * escaparate de datos: sólo lo que el proveedor ya publica en su perfil.
 *
 * Este módulo decide, en funciones puras, dos cosas peligrosas si se hacen mal:
 * qué datos salen al público y si la vitrina permite reservar.
 */

/** Estados en los que la vitrina existe pero no se puede reservar. */
const ESTADOS_NO_RESERVABLES = Object.freeze(['EXPLORACION', 'EN_VERIFICACION', 'SUSPENDIDO']);

/**
 * Convierte un nombre en slug: minúsculas, sin acentos, guiones simples.
 * `null` si no queda nada usable (evita slugs vacíos que colisionan entre sí).
 */
function generarSlug(nombre) {
  const base = String(nombre || '')
    .normalize('NFD')
    // Marcas diacríticas: "Valentina P." → "valentina p."
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);

  return base === '' ? null : base;
}

/**
 * Resuelve la colisión añadiendo un sufijo numérico, sin consultar la base:
 * el llamador decide qué sufijo está libre.
 */
function slugConSufijo(slug, numero) {
  if (!slug) return null;
  const n = Number(numero);
  if (!Number.isFinite(n) || n <= 0) return slug;
  const sufijo = `-${n}`;
  return `${slug.slice(0, 60 - sufijo.length)}${sufijo}`;
}

/**
 * Perfil público a partir de la fila del proveedor.
 *
 * @param {object} fila
 * @param {string} fila.nombre
 * @param {string} [fila.foto_url]
 * @param {string} [fila.ciudad]
 * @param {string} [fila.bio]
 * @param {string} [fila.slug]
 * @param {string} [fila.estado_operativo]
 * @returns {object} perfil público
 */
function construirPerfilPublico(fila = {}) {
  const estado = String(fila.estado_operativo || 'EXPLORACION').toUpperCase();
  const reservable = !ESTADOS_NO_RESERVABLES.includes(estado);

  return {
    nombre: fila.nombre || '',
    slug: fila.slug || null,
    foto_url: fila.foto_url || null,
    ciudad: fila.ciudad || null,
    bio: fila.bio || null,
    reservable,
    sello: reservable ? null : 'Perfil en preparación · aún no recibe reservas',
    // Nunca se expone el estado interno: al público sólo le importa si reserva.
    estado: reservable ? 'ACTIVO' : 'EN_PREPARACION',
  };
}

module.exports = {
  ESTADOS_NO_RESERVABLES,
  generarSlug,
  slugConSufijo,
  construirPerfilPublico,
};

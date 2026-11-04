// backend/src/utils/serviceSelection.js
/**
 * Utilidades puras para la selección de servicios de una reserva.
 *
 * El contrato de `POST /api/bookings` exige que TODOS los ids enviados
 * pertenezcan al prestador. Un id repetido, vacío o ya borrado rompía ese
 * contrato con un 404 que no decía cuál id sobraba. Estas funciones no tocan
 * base de datos ni Express: se prueban con datos en memoria.
 */

/** Quita vacíos y duplicados conservando el orden de llegada. */
function dedupeServiceIds(raw) {
  if (!Array.isArray(raw)) return [];
  const vistos = new Set();
  const ids = [];
  for (const valor of raw) {
    if (valor === null || valor === undefined) continue;
    const id = String(valor).trim();
    if (!id || vistos.has(id)) continue;
    vistos.add(id);
    ids.push(id);
  }
  return ids;
}

/** Ids pedidos que no aparecieron en la consulta, en el orden pedido. */
function missingServiceIds(requested, found) {
  const encontrados = new Set((found || []).map((s) => String(s.id)));
  return requested.filter((id) => !encontrados.has(id));
}

module.exports = { dedupeServiceIds, missingServiceIds };

/**
 * Formateo de valores numéricos que vienen de la API.
 *
 * Por qué existe este módulo:
 *   Las columnas NUMERIC de PostgreSQL llegan como string y ADEMÁS pueden ser null
 *   (`productos.costo` se añadió sin NOT NULL en la migración 071, y el propio
 *   backend lo comprueba en 8 sitios). El formateador que tenía /admin/productos
 *   hacía:
 *
 *     const num = typeof price === 'string' ? parseFloat(price) : price;
 *     return isNaN(num) ? '-' : `$${num.toLocaleString('es-CO')}`;
 *
 *   con `price = null` → `num = null` → **`isNaN(null)` es `false`** porque
 *   `Number(null) === 0`, así que el guard no lo atrapa y la pantalla revienta con
 *   "Cannot read properties of null (reading 'toLocaleString')".
 *
 * Regla: un valor ausente, vacío o no numérico NUNCA lanza. Se pinta '-'.
 */

/**
 * Convierte a número finito, o null si el valor no sirve.
 *
 * Solo se aceptan `number` y `string`. Cualquier otra cosa (null, undefined,
 * booleanos, objetos, arrays) devuelve null. La coerción laxa no sirve aquí:
 * `Number(String([]))` es 0 y `Number(String([5]))` es 5, así que un array se
 * convertiría en un precio creíble — el mismo error de `isNaN(null) === false`
 * que causó el crash original.
 */
function aNumero(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const limpio = value.trim();
    if (limpio === '') return null;
    const num = Number(limpio);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

/** Precio con símbolo. null / undefined / '' / no numérico -> '-'. */
export function formatPrecio(value: unknown): string {
  const num = aNumero(value);
  return num === null ? '-' : `$${num.toLocaleString('es-CO')}`;
}

/** Número con separadores, sin símbolo. Mismo criterio de degradación. */
export function formatNumero(value: unknown): string {
  const num = aNumero(value);
  return num === null ? '-' : num.toLocaleString('es-CO');
}

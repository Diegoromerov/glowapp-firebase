// backend/src/config/biometricRetention.js
//
// T-111 — Plazo de conservación de los datos biométricos.
//
// Por qué existe: hasta hoy no había ningún plazo escrito. La base guardaba los
// escaneos para siempre y el aviso no decía hasta cuándo. La Ley 1581 de 2012 exige
// finalidad y temporalidad; sin lo segundo, «conservamos tus datos» es una promesa
// sin fecha y el titular no puede saber cuándo dejan de existir.
//
// Decisión del Director (2026-10-20): **24 meses desde el último escaneo**, mismo
// plazo para la serie de evolución, purga también de usuarios inactivos, borrado
// inmediato al cerrar la cuenta y constancia del borrado sin datos dentro.
//
// El plazo se lee del entorno en cada llamada —no se congela al importar— para que
// cambiarlo en Railway cambie a la vez el job y el texto del aviso.

/** Meses por defecto si el entorno no dice otra cosa. */
const DEFAULT_RETENTION_MONTHS = 24;

/**
 * Meses de conservación configurados.
 * @returns {number} entero positivo; cae al valor por defecto si el entorno es basura.
 */
function getRetentionMonths() {
  const raw = Number.parseInt(process.env.BIOMETRIC_RETENTION_MONTHS, 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return DEFAULT_RETENTION_MONTHS;
}

/**
 * Fecha de corte: lo capturado antes de este instante ya cumplió su plazo.
 *
 * Se cuenta **desde el último escaneo del usuario**, no desde el primero: quien mide
 * todos los meses conserva su serie, y quien dejó de medir deja de acumular datos.
 * Por eso la purga mira `captured_at` de cada sesión: una sesión vieja de un usuario
 * activo también caduca, que es justo lo que la temporalidad exige.
 *
 * @param {Date} [now] instante de referencia (inyectable para pruebas)
 * @param {number} [months] meses de plazo (por defecto, los configurados)
 * @returns {Date} instante de corte
 */
function retentionCutoff(now = new Date(), months = getRetentionMonths()) {
  const cutoff = new Date(now.getTime());
  cutoff.setMonth(cutoff.getMonth() - months);
  return cutoff;
}

/**
 * Descripción del plazo para el aviso y la documentación.
 * `retentionMonths` no se escribe a mano en el texto: sale de aquí, que sale del entorno.
 */
function describeRetention() {
  const months = getRetentionMonths();
  return Object.freeze({
    retentionMonths: months,
    from: 'el último escaneo',
    whatIsKept: 'las métricas del análisis y el resultado del escaneo (no la fotografía original)',
    whatIsDeleted: 'el escaneo y su serie se eliminan al cumplir el plazo, también si la cuenta sigue abierta pero dejó de usarse',
    onAccountDeletion: 'se borran de inmediato todos los datos biométricos y se conserva únicamente constancia de que el borrado ocurrió, sin ningún dato dentro',
  });
}

module.exports = {
  DEFAULT_RETENTION_MONTHS,
  getRetentionMonths,
  retentionCutoff,
  describeRetention,
};

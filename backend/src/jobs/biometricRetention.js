// backend/src/jobs/biometricRetention.js
//
// T-111 — Purga de escaneos que ya cumplieron su plazo.
//
// El aviso 2.2 promete un plazo (24 meses desde el último escaneo). Una promesa sin
// job es una frase: nadie borra nada y el dato sigue ahí. Este job es la parte que
// cumple lo que el texto dice.
//
// Reglas de la decisión del Director:
//   * se borra el escaneo y su comparación al cumplir el plazo, aunque la cuenta siga
//     abierta (la inactividad no prolonga la conservación);
//   * la purga **no** deja datos personales: sólo una fila agregada en el log de
//     auditoría con el corte y los conteos;
//   * `dryRun` cuenta sin borrar, para poder mirar antes de ejecutar.

const { pool } = require('../config/db');
const { retentionCutoff, getRetentionMonths } = require('../config/biometricRetention');

/** Nombre del proceso en el log, para distinguirlo de los accesos de usuario. */
const RETENTION_ACTOR = 'system_retention';

/**
 * Cuenta los registros que caducaron sin borrar nada.
 * @param {Date} cutoff
 */
async function contarExpirados(cutoff) {
  const sesiones = await pool.query(
    'SELECT COUNT(*)::int AS n FROM biometric_scan_sessions WHERE captured_at < $1',
    [cutoff]
  );
  const comparaciones = await pool.query(
    `SELECT COUNT(*)::int AS n
       FROM biometric_scan_comparisons c
      WHERE EXISTS (SELECT 1 FROM biometric_scan_sessions s
                     WHERE s.id IN (c.baseline_scan_id, c.current_scan_id)
                       AND s.captured_at < $1)`,
    [cutoff]
  );
  return {
    sessions: sesiones.rows?.[0]?.n ?? 0,
    comparisons: comparaciones.rows?.[0]?.n ?? 0,
  };
}

/**
 * Borra los escaneos (y sus comparaciones) capturados antes del corte.
 *
 * Las comparaciones van primero: cuelgan de las sesiones por `baseline_scan_id` y
 * `current_scan_id`, y borrar la sesión antes dejaría comparaciones huérfanas o haría
 * fallar el DELETE por la clave foránea.
 *
 * @param {Object} [options]
 * @param {Date} [options.now] instante de referencia (pruebas y ejecuciones manuales)
 * @param {boolean} [options.dryRun] sólo contar
 * @returns {Promise<{cutoff: Date, months: number, sessionsDeleted: number,
 *   comparisonsDeleted: number, dryRun: boolean}>}
 */
async function purgarEscaneosExpirados({ now = new Date(), dryRun = false } = {}) {
  const months = getRetentionMonths();
  const cutoff = retentionCutoff(now, months);

  if (dryRun) {
    const { sessions, comparisons } = await contarExpirados(cutoff);
    return {
      cutoff, months, dryRun: true, sessionsDeleted: sessions, comparisonsDeleted: comparisons,
    };
  }

  const client = typeof pool.connect === 'function' ? await pool.connect() : null;
  const queryable = client || pool;
  let sessionsDeleted = 0;
  let comparisonsDeleted = 0;

  try {
    if (client) await client.query('BEGIN');

    const comparaciones = await queryable.query(
      `DELETE FROM biometric_scan_comparisons
        WHERE baseline_scan_id IN (SELECT id FROM biometric_scan_sessions WHERE captured_at < $1)
           OR current_scan_id IN (SELECT id FROM biometric_scan_sessions WHERE captured_at < $1)`,
      [cutoff]
    );
    comparisonsDeleted = comparaciones.rowCount || 0;

    const sesiones = await queryable.query(
      'DELETE FROM biometric_scan_sessions WHERE captured_at < $1',
      [cutoff]
    );
    sessionsDeleted = sesiones.rowCount || 0;

    // Auditoría agregada: cuántos y hasta qué fecha, sin un solo identificador.
    // Es la constancia de que el borrado ocurrió, sin volver a guardar lo borrado.
    await queryable.query(
      `INSERT INTO biometric_access_log (user_id, accessed_by, access_type, details)
       VALUES (NULL, $1, 'retention_purge', $2)`,
      [RETENTION_ACTOR, JSON.stringify({
        cutoff: cutoff.toISOString(),
        retentionMonths: months,
        sessionsDeleted,
        comparisonsDeleted,
      })]
    );

    if (client) await client.query('COMMIT');
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    console.error('❌ Error en la purga de datos biométricos:', error.message);
    throw error;
  } finally {
    if (client) client.release();
  }

  console.log(
    `🗑️  Retención biométrica: ${sessionsDeleted} escaneos y ${comparisonsDeleted} `
    + `comparaciones anteriores a ${cutoff.toISOString()} eliminados.`
  );

  return { cutoff, months, dryRun: false, sessionsDeleted, comparisonsDeleted };
}

/**
 * Arranca la purga diaria. Se ejecuta a las 4 de la madrugada (hora del servidor), fuera
 * de las ventanas de los jobs de pagos (2, 3 y 6).
 * @returns {NodeJS.Timeout} el intervalo, para poder limpiarlo en pruebas
 */
function iniciarRetencionBiometrica() {
  console.log('⚙️  Retención biométrica: purga diaria a las 4:00.');
  return setInterval(async () => {
    if (new Date().getHours() !== 4) return;
    try {
      await purgarEscaneosExpirados();
    } catch (error) {
      // El job no debe tumbar el proceso: se registra y se reintenta mañana.
      console.error('❌ La purga biométrica falló:', error.message);
    }
  }, 60 * 60 * 1000);
}

module.exports = {
  RETENTION_ACTOR,
  contarExpirados,
  purgarEscaneosExpirados,
  iniciarRetencionBiometrica,
};

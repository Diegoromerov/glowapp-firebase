// backend/src/services/biometric/history.service.js
//
// Y-F6 — La serie del usuario, leída tal como se guardó.
//
// Por qué existe: Y-F3 dejó el delta persistido y Y-F5 la huella, pero el usuario
// sólo veía el veredicto de su último escaneo. El dato estaba y nadie lo miraba.
//
// Regla que respeta: **no se recalcula nada.** El GlowScore sale de lo que quedó en
// `quality.glowScore` al medir y el delta del detalle cifrado de la comparación. Si
// un escaneo viejo no tiene puntaje guardado, se devuelve `null` en vez de inventarlo
// con las métricas de hoy (el modelo de puntaje puede haber cambiado entre escaneos).
//
// Lo que se descifra: sólo el bloque de la comparación, y sólo para extraer el Δ del
// GlowScore. Verdicto y contadores se leen en claro, como los dejó Y-F3.

const { pool } = require('../../config/db');
const biometricCryptoService = require('../biometricCryptoService');
const logger = require('../../config/logger');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** Normaliza el límite pedido: 1..50, entero; cualquier otra cosa cae al valor por defecto. */
function normalizeLimit(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

class HistoryService {
  /**
   * Serie de escaneos del usuario, más reciente primero.
   *
   * @param {number} userId
   * @param {{limit?: number}} [opts]
   * @returns {Promise<{scans: Array, limit: number}>}
   */
  async list(userId, { limit } = {}) {
    const parsedUserId = Number.parseInt(userId, 10);
    if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
      const error = new Error('Usuario inválido para consultar el historial.');
      error.code = 'INVALID_USER';
      error.statusCode = 400;
      throw error;
    }

    const effectiveLimit = normalizeLimit(limit);

    const res = await pool.query(
      `SELECT s.id,
              s.captured_at,
              s.metrics_count,
              s.consent_version,
              s.quality->>'glowScore' AS glow_score,
              c.id            AS comparison_id,
              c.baseline_scan_id,
              c.verdict,
              c.compared_count,
              c.significant_count,
              c.metrics_encrypted
         FROM biometric_scan_sessions s
         LEFT JOIN biometric_scan_comparisons c ON c.current_scan_id = s.id
        WHERE s.user_id = $1
        ORDER BY s.captured_at DESC, s.id DESC
        LIMIT $2`,
      [parsedUserId, effectiveLimit]
    );

    const scans = res.rows.map((row) => this._mapRow(row));

    return { scans, limit: effectiveLimit };
  }

  /** Fila de SQL → objeto de respuesta. Nunca lanza: un detalle ilegible deja el delta en null. */
  _mapRow(row) {
    const glowScore = row.glow_score === null || row.glow_score === undefined ? null : Number(row.glow_score);

    const scan = {
      scanId: Number(row.id),
      capturedAt: row.captured_at,
      metricsCount: row.metrics_count,
      glowScore: Number.isFinite(glowScore) ? glowScore : null,
      consentVersion: row.consent_version || null,
      comparison: null,
    };

    if (!row.comparison_id) return scan;

    let deltaGlowScore = null;
    try {
      const detail = biometricCryptoService.decrypt(row.metrics_encrypted);
      const delta = detail && detail.glowScore && detail.glowScore.delta;
      if (Number.isFinite(delta)) deltaGlowScore = delta;
    } catch (error) {
      // No se cae la lista por un registro que no descifra: se informa sin delta.
      logger.warn('Comparación no descifrable al armar el historial', {
        comparisonId: row.comparison_id,
        error: error.message,
      });
    }

    scan.comparison = {
      id: Number(row.comparison_id),
      baselineScanId: Number(row.baseline_scan_id),
      verdict: row.verdict,
      compared: row.compared_count,
      significant: row.significant_count,
      deltaGlowScore,
    };

    return scan;
  }
}

module.exports = new HistoryService();
module.exports.normalizeLimit = normalizeLimit;
module.exports.DEFAULT_LIMIT = DEFAULT_LIMIT;
module.exports.MAX_LIMIT = MAX_LIMIT;

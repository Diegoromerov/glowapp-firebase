// backend/src/services/biometric/scanComparison.service.js
//
// Y-F3 — Persistencia de la comparación entre dos escaneos.
// El detalle por métrica va cifrado (ADR-001); en claro solo veredicto y contadores.

const { pool } = require('../../config/db');
const biometricCryptoService = require('../biometricCryptoService');
const logger = require('../../config/logger');

class ScanComparisonService {
  /**
   * @param {Object} params
   * @param {number} params.userId
   * @param {number} params.baselineScanId
   * @param {number} params.currentScanId
   * @param {Object} params.result - salida de delta.service.compareScans
   * @param {boolean} [params.tolerante=true]
   */
  async save({ userId, baselineScanId, currentScanId, result, tolerante = true }) {
    if (!Number.isInteger(userId) || !Number.isInteger(baselineScanId) || !Number.isInteger(currentScanId)) {
      return { persisted: false, reason: 'ids inválidos' };
    }
    if (baselineScanId === currentScanId) {
      return { persisted: false, reason: 'baseline y actual son el mismo escaneo' };
    }

    const encrypted = biometricCryptoService.encrypt({
      version: 1,
      threshold: result.threshold,
      verdict: result.verdict,
      glowScore: result.glowScore,
      comparisons: result.comparisons,
      byFamily: result.byFamily,
      byZone: result.byZone,
      onlyInBaseline: result.onlyInBaseline,
      onlyInCurrent: result.onlyInCurrent,
      notes: result.notes,
    });

    try {
      const res = await pool.query(
        `INSERT INTO biometric_scan_comparisons
           (user_id, baseline_scan_id, current_scan_id, threshold, verdict,
            compared_count, significant_count, metrics_encrypted)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (current_scan_id) DO NOTHING
         RETURNING id, created_at`,
        [
          userId,
          baselineScanId,
          currentScanId,
          result.threshold,
          result.verdict,
          result.compared || 0,
          result.significant || 0,
          encrypted,
        ]
      );

      if (res.rows.length === 0) {
        return { persisted: false, reason: 'comparación ya existente para este escaneo' };
      }
      return { persisted: true, id: res.rows[0].id, createdAt: res.rows[0].created_at };
    } catch (error) {
      logger.error('No se pudo persistir la comparación de escaneos', {
        userId,
        baselineScanId,
        currentScanId,
        error: error.message,
      });
      if (!tolerante) throw error;
      return { persisted: false, reason: error.message };
    }
  }

  /** Última comparación del usuario, descifrada. */
  async getLatest(userId) {
    const res = await pool.query(
      `SELECT id, user_id, baseline_scan_id, current_scan_id, threshold, verdict,
              compared_count, significant_count, metrics_encrypted, created_at
         FROM biometric_scan_comparisons
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [userId]
    );
    if (res.rows.length === 0) return null;

    const row = res.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      baselineScanId: row.baseline_scan_id,
      currentScanId: row.current_scan_id,
      threshold: Number(row.threshold),
      verdict: row.verdict,
      compared: row.compared_count,
      significant: row.significant_count,
      createdAt: row.created_at,
      detail: biometricCryptoService.decrypt(row.metrics_encrypted),
    };
  }
}

module.exports = new ScanComparisonService();

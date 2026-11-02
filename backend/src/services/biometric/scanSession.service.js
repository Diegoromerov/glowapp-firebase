// backend/src/services/biometric/scanSession.service.js
//
// Y-F1: persistencia de la llamada completa a YouCam.
//
// Guarda el bloque de métricas cifrado (ADR-001: los scores derivados de una foto son
// datos biométricos) junto con los metadatos no identificatorios que permiten auditar
// qué se pidió y qué no volvió: provider_task_id, acciones pedidas, acciones ausentes
// y número de métricas.
//
// No lanza si la escritura falla cuando se le pide `tolerante: true` (el análisis ya
// se pagó; perder el registro no debe romper la respuesta al usuario), pero devuelve
// `persisted: false` y el motivo para que el llamador lo registre.

const { pool } = require('../../config/db');
const biometricCryptoService = require('../biometricCryptoService');
const imageHashService = require('./imageHash.service');
const logger = require('../../config/logger');
const { BIOMETRIC_CONSENT_VERSION, isOutdatedConsent } = require('../../config/consentConfig');

// Y-F5: ventana en la que se reutiliza el análisis de una foto idéntica.
// 24 h por defecto; `0` desactiva la caché sin cambiar código.
const DEFAULT_CACHE_TTL_HOURS = 24;

function getCacheTtlHours() {
  const raw = parseInt(process.env.BIOMETRIC_CACHE_TTL_HOURS ?? '', 10);
  return Number.isInteger(raw) && raw >= 0 ? raw : DEFAULT_CACHE_TTL_HOURS;
}

const CONSENT_TYPE = 'facial_analysis';

class ScanSessionService {
  /**
   * @param {Object} params
   * @param {number} params.userId
   * @param {Object} params.faceScores - Resultado completo de youcam.client.analyzeFace
   * @param {boolean} [params.tolerante] - Si true, no propaga el error de escritura
   * @returns {Promise<{persisted: boolean, id?: number, metricsCount: number, reason?: string}>}
   */
  async saveScan({ userId, faceScores, geometry = null, quality = null, fingerprint = null, tolerante = true }) {
    const metrics = faceScores?.metrics && typeof faceScores.metrics === 'object' ? faceScores.metrics : {};
    const metricsCount = Object.keys(metrics).length;

    if (!Number.isInteger(userId) || userId <= 0) {
      return { persisted: false, metricsCount, reason: 'userId inválido' };
    }
    if (metricsCount === 0) {
      return { persisted: false, metricsCount, reason: 'sin métricas para persistir' };
    }

    const payload = {
      version: 1,
      provider: 'youcam',
      providerTaskId: faceScores.providerTaskId || null,
      requestedActions: faceScores.requestedActions || [],
      missing: faceScores.missing || [],
      metrics,
      skinType: faceScores.skinType || null,
      skinAge: faceScores.skinAge || null,
      overall: faceScores.overall || null,
      legacy: {
        hydration: faceScores.hydration,
        wrinkles: faceScores.wrinkles,
        spots: faceScores.spots,
        pores: faceScores.pores,
        subtono: faceScores.subtono,
        bioAge: faceScores.bioAge,
      },
      // Y-F2/Y-F3: el tipo de piel y la base del subtono vivían solo en memoria, así que
      // el historial no podía explicar de dónde salía el valor. Se guardan con la sesión.
      skin: {
        pielTipo: faceScores.pielTipo || null,
        subtono: faceScores.subtono ?? null,
        subtonoFuente: faceScores.subtonoFuente || 'no_medido',
        medicion: faceScores.subtonoMedicion || null,
      },
      masks: faceScores.masks || [],
      // Y-F5: el descriptor perceptual viaja CIFRADO con el resto del análisis, porque
      // es un dato biométrico derivado y ADR-001 exige cifrarlo en reposo.
      fingerprint: {
        dhash: fingerprint?.dhash || null,
        algorithm: 'dhash64',
      },
    };

    const encrypted = biometricCryptoService.encrypt(payload);

    // Y-F1b: con qué texto autorizó el usuario. Si la consulta falla no se bloquea el
    // guardado: se registra como versión desconocida y el escaneo queda marcado.
    const consentVersion = await this._getConsentVersion(userId);
    const consentOutdated = isOutdatedConsent(consentVersion);

    try {
      const result = await pool.query(
        `INSERT INTO biometric_scan_sessions
           (user_id, provider, provider_task_id, metrics_encrypted, metrics_count,
            requested_actions, missing_metrics, geometry, quality,
            consent_version, consent_outdated, image_hash)
         VALUES ($1, 'youcam', $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11)
         RETURNING id, captured_at`,
        [
          userId,
          payload.providerTaskId,
          encrypted,
          metricsCount,
          JSON.stringify(payload.requestedActions),
          JSON.stringify(payload.missing),
          geometry ? JSON.stringify(geometry) : null,
          quality ? JSON.stringify(quality) : null,
          consentVersion,
          consentOutdated,
          // Y-F5: solo el HMAC con pepper; el descriptor va dentro del cifrado.
          fingerprint?.hmac || null,
        ]
      );

      const row = result.rows[0];
      return {
        persisted: true,
        id: row.id,
        capturedAt: row.captured_at,
        metricsCount,
        consentVersion,
        consentOutdated,
      };
    } catch (error) {
      logger.error('No se pudo persistir la sesión de escaneo biométrico', {
        userId,
        metricsCount,
        error: error.message,
      });
      if (!tolerante) throw error;
      return { persisted: false, metricsCount, consentVersion, consentOutdated, reason: error.message };
    }
  }

  /**
   * `version_terms` del consentimiento facial vigente. Devuelve null si no hay
   * consentimiento legible: eso marca el escaneo como desactualizado en vez de
   * inventar la versión vigente.
   */
  async _getConsentVersion(userId) {
    try {
      const result = await pool.query(
        `SELECT version_terms
           FROM biometric_consents
          WHERE user_id = $1 AND consent_type = $2
            AND granted = TRUE AND revoked_at IS NULL
          ORDER BY granted_at DESC NULLS LAST
          LIMIT 1`,
        [userId, CONSENT_TYPE]
      );
      return result.rows?.[0]?.version_terms || null;
    } catch (error) {
      logger.warn('No se pudo leer la versión del consentimiento biométrico', { userId, error: error.message });
      return null;
    }
  }

  /** Descifra una sesión guardada. Uso: verificación y fases de delta (Y-F3). */
  async getScan(id) {
    const result = await pool.query(
      `SELECT id, user_id, provider, provider_task_id, metrics_encrypted, metrics_count,
              requested_actions, missing_metrics, geometry, quality,
              consent_version, consent_outdated, captured_at
         FROM biometric_scan_sessions WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      provider: row.provider,
      providerTaskId: row.provider_task_id,
      metricsCount: row.metrics_count,
      requestedActions: row.requested_actions,
      missing: row.missing_metrics,
      geometry: row.geometry,
      quality: row.quality,
      consentVersion: row.consent_version,
      consentOutdated: row.consent_outdated,
      consentVersionCurrent: BIOMETRIC_CONSENT_VERSION,
      capturedAt: row.captured_at,
      payload: biometricCryptoService.decrypt(row.metrics_encrypted),
    };
  }

  getCacheTtlHours() {
    return getCacheTtlHours();
  }

  /**
   * Y-F5: escaneo reutilizable del MISMO usuario con la MISMA foto.
   *
   * Devuelve null si no hay coincidencia, si la ventana expiró o si la lectura falla.
   * Fail-open a propósito: no reutilizar cuesta una unidad, bloquear el análisis cuesta
   * la confianza del usuario. Nunca se busca fuera del `user_id`: la foto de otra
   * persona no puede devolver métricas ajenas.
   */
  async findReusableScan({ userId, fingerprint, ttlHours = getCacheTtlHours() }) {
    if (!Number.isInteger(userId) || userId <= 0) return null;
    if (!Number.isInteger(ttlHours) || ttlHours <= 0) return null;
    if (!fingerprint || (!fingerprint.hmac && !fingerprint.dhash)) return null;

    try {
      // Se traen las últimas sesiones de ESTE usuario dentro de la ventana y se compara
      // descifrando el descriptor: no está en claro en la base (ADR-001).
      const result = await pool.query(
        `SELECT id, captured_at, metrics_encrypted, image_hash
           FROM biometric_scan_sessions
          WHERE user_id = $1
            AND captured_at >= NOW() - ($2::text || ' hours')::interval
          ORDER BY captured_at DESC
          LIMIT 20`,
        [userId, String(ttlHours)]
      );

      for (const row of result.rows || []) {
        // Camino rápido: el HMAC coincide, no hace falta descifrar para saberlo.
        if (fingerprint.hmac && row.image_hash === fingerprint.hmac) {
          try {
            return {
              id: row.id,
              capturedAt: row.captured_at,
              payload: biometricCryptoService.decrypt(row.metrics_encrypted),
              match: 'hash_exacto',
              distance: 0,
            };
          } catch (error) {
            continue; // fila ilegible: se sigue con la comparación perceptual
          }
        }

        let payload;
        try {
          payload = biometricCryptoService.decrypt(row.metrics_encrypted);
        } catch (error) {
          // Fila ilegible: se ignora esta fila, la búsqueda sigue.
          continue;
        }

        const match = imageHashService.isSamePhoto(fingerprint, {
          hmac: row.image_hash,
          dhash: payload?.fingerprint?.dhash || null,
        });
        if (!match.same) continue;

        return {
          id: row.id,
          capturedAt: row.captured_at,
          payload,
          match: match.reason,
          distance: match.distance,
        };
      }

      return null;
    } catch (error) {
      logger.warn('No se pudo buscar un escaneo reutilizable; se analiza de nuevo', {
        userId,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Reconstruye el `faceScores` plano que espera el orquestador desde el payload
   * guardado. Sin esto, un acierto de caché devolvería la forma persistida y rompería
   * el cálculo de GlowScore y de familias dérmicas.
   */
  restoreFaceScores(payload) {
    if (!payload || typeof payload !== 'object') return null;

    const legacy = payload.legacy || {};
    const skin = payload.skin || {};

    return {
      hydration: legacy.hydration,
      wrinkles: legacy.wrinkles,
      spots: legacy.spots,
      pores: legacy.pores,
      bioAge: legacy.bioAge,
      pielTipo: skin.pielTipo || payload.skinType || null,
      subtono: skin.subtono ?? legacy.subtono ?? null,
      subtonoFuente: skin.subtonoFuente || 'no_medido',
      subtonoMedicion: skin.medicion || null,
      skinType: payload.skinType || null,
      skinAge: payload.skinAge || null,
      overall: payload.overall || null,
      masks: payload.masks || [],
      metrics: payload.metrics || {},
      providerTaskId: payload.providerTaskId || null,
      requestedActions: payload.requestedActions || [],
      missing: payload.missing || [],
      reutilizado: true,
    };
  }

  /**
   * Escaneo inmediatamente anterior del usuario (Y-F3). Devuelve null si es el primero.
   */
  async getPrevious(userId, currentScanId) {
    const result = await pool.query(
      `SELECT id, metrics_encrypted, captured_at
         FROM biometric_scan_sessions
        WHERE user_id = $1 AND id < $2
        ORDER BY captured_at DESC, id DESC
        LIMIT 1`,
      [userId, currentScanId]
    );
    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      capturedAt: row.captured_at,
      payload: biometricCryptoService.decrypt(row.metrics_encrypted),
    };
  }
}

module.exports = new ScanSessionService();

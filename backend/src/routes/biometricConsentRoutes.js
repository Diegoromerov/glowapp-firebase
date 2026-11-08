const { wrapRouterAsync } = require('../utils/expressAsync');
﻿/**
 * backend/src/routes/biometricConsentRoutes.js
 * Rutas API para gestion de consentimientos biometricos
 * Cumple Ley 1581/2012: derechos de acceso, rectificacion, supresion
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { getJwtSecret } = require('../config/jwt');
const {
  BIOMETRIC_CONSENT_VERSION,
  buildBiometricConsentTerms,
  isSupportedConsentVersion,
  isOutdatedConsent,
} = require('../config/consentConfig');
const { 
  getUserConsents, 
  grantConsent, 
  revokeConsent, 
  deleteBiometricData,
  getAccessLogs,
  logBiometricAccess,
  verifyConsent,
  VALID_CONSENT_TYPES
} = require('../middleware/biometricConsent');
const { pool } = require('../config/db');

function currentTermsDocument() {
  const data = buildBiometricConsentTerms();
  const document_sha256 = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  return { data, document_sha256 };
}

function auditSubjectRef(userId) {
  const secret = process.env.AUDIT_PSEUDONYM_SECRET || getJwtSecret();
  return crypto.createHmac('sha256', secret).update(`glowapp-biometric-audit:${userId}`).digest('hex');
}

function parseAuditDate(value) {
  if (value === undefined) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function applyAuditFilters(query, params, filters, { allowSubject = false } = {}) {
  let index = params.length + 1;
  if (filters.from) { query += ` AND happened_at >= $${index++}::timestamptz`; params.push(filters.from); }
  if (filters.to) { query += ` AND happened_at <= $${index++}::timestamptz`; params.push(filters.to); }
  if (filters.eventType) { query += ` AND event_type = $${index++}`; params.push(filters.eventType); }
  if (filters.consentType) { query += ` AND consent_type = $${index++}`; params.push(filters.consentType); }
  if (allowSubject && filters.userId) { query += ` AND user_id = $${index++}`; params.push(filters.userId); }
  return query;
}

/**
 * @route GET /api/consent/biometric
 * @description Obtiene todos los consentimientos biometricos del usuario autenticado
 * @access Private
 * @returns {Object} Lista de consentimientos con estado
 */
router.get('/biometric', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const consents = await getUserConsents(userId);
    
    res.json({
      success: true,
      data: consents,
      message: 'Consentimientos biometricos obtenidos'
    });
  } catch (error) {
    console.error('Error GET /consent/biometric:', error.message);
    res.status(500).json({ 
      error: 'internal_error', 
      message: 'Error obteniendo consentimientos' 
    });
  }
});

// Compatibilidad con clientes legacy: el recurso solo se consulta contra el ID del JWT.
router.get('/status/:userId', authMiddleware, async (req, res) => {
  if (String(req.params.userId) !== String(req.user.id)) {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'Solo puedes consultar tu propio consentimiento.' });
  }
  try {
    const consents = await getUserConsents(req.user.id);
    const hasActiveConsent = consents.some((item) => item.consent_type === 'facial_analysis'
      && item.granted === true
      && !item.revoked_at
      && item.version_terms === BIOMETRIC_CONSENT_VERSION
      && item.explicit_authorization === true
      && Boolean(item.document_sha256));
    return res.json({ success: true, hasActiveConsent, consents });
  } catch (error) {
    return res.status(500).json({ error: 'internal_error', message: 'Error verificando consentimiento.' });
  }
});

/**
 * @route GET /api/consent/biometric/:consentType
 * @description Verifica si el usuario tiene consentimiento especifico
 * @access Private
 * @returns {Object} Estado del consentimiento
 */
router.get('/biometric/:consentType', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { consentType } = req.params;
    
    if (!VALID_CONSENT_TYPES.includes(consentType)) {
      return res.status(400).json({
        error: 'invalid_consent_type',
        message: 'Tipo de consentimiento invalido. Validos: ' + VALID_CONSENT_TYPES.join(', ')
      });
    }
    
    const { allowed, reason, consent, code } = await verifyConsent(userId, consentType);
    
    res.json({
      success: true,
      data: {
        consent_type: consentType,
        allowed,
        reason,
        code,
        // Y-F1b: la versión vigente viaja con la respuesta para que el cliente pueda
        // pedir re-consentimiento sin adivinar el número.
        current_version: BIOMETRIC_CONSENT_VERSION,
        outdated: consent ? (isOutdatedConsent(consent.version_terms)
          || (consent.granted === true && (consent.explicit_authorization !== true || !consent.document_sha256))) : false,
        consent: consent ? {
          id: consent.id,
          granted: consent.granted,
          granted_at: consent.granted_at,
          revoked_at: consent.revoked_at,
          purpose: consent.purpose,
          version_terms: consent.version_terms,
          explicit_authorization: consent.explicit_authorization,
          document_sha256: consent.document_sha256
        } : null
      }
    });
  } catch (error) {
    console.error('Error GET /consent/biometric/:type:', error.message);
    res.status(500).json({ 
      error: 'internal_error', 
      message: 'Error verificando consentimiento' 
    });
  }
});

/**
 * @route POST /api/consent/biometric
 * @description Otorga consentimiento biometrico
 * @access Private
 * @body { consent_type, purpose, version_terms? }
 * @returns {Object} Consentimiento creado
 */
router.post('/biometric', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      consent_type,
      purpose,
      version_terms = BIOMETRIC_CONSENT_VERSION,
      explicit_authorization,
      document_sha256,
    } = req.body;
    const termsDocument = currentTermsDocument();

    // Y-F1b: la versión que se registra debe ser una que el backend conozca. Antes el
    // campo se aceptaba sin validar (o se ignoraba y quedaba '1.0'): el registro
    // auditable decía una versión que el usuario nunca vio.
    if (!isSupportedConsentVersion(version_terms)) {
      return res.status(400).json({
        error: 'invalid_version_terms',
        message: `version_terms debe ser una de: ${BIOMETRIC_CONSENT_VERSION} (vigente). Recibido: ${version_terms}`
      });
    }
    if (version_terms !== BIOMETRIC_CONSENT_VERSION
        || explicit_authorization !== true
        || typeof document_sha256 !== 'string'
        || document_sha256 !== termsDocument.document_sha256) {
      return res.status(409).json({
        error: 'explicit_current_consent_required',
        code: 'CONSENT_TERMS_CHANGED',
        current_version: BIOMETRIC_CONSENT_VERSION,
        message: 'Lee el aviso vigente y marca la autorización expresa antes de continuar.',
      });
    }
    // Validaciones
    if (!consent_type || !VALID_CONSENT_TYPES.includes(consent_type)) {
      return res.status(400).json({
        error: 'invalid_consent_type',
        message: 'Tipo de consentimiento requerido y debe ser uno de: ' + VALID_CONSENT_TYPES.join(', ')
      });
    }
    
    if (!purpose || purpose.trim().length < 10) {
      return res.status(400).json({
        error: 'invalid_purpose',
        message: 'La finalidad (purpose) es requerida y debe tener al menos 10 caracteres'
      });
    }
    if (purpose.trim() !== termsDocument.data.purpose) {
      return res.status(400).json({
        error: 'purpose_mismatch',
        message: 'La finalidad autorizada debe corresponder al aviso vigente mostrado al titular.',
      });
    }
    
    const consent = await grantConsent({
      userId,
      consentType: consent_type,
      purpose: purpose.trim(),
      ip: req.ip,
      userAgent: req.get('user-agent'),
      versionTerms: version_terms,
      explicitAuthorization: true,
      documentSha256: termsDocument.document_sha256,
      termsSnapshot: termsDocument.data,
    });
    
    res.status(201).json({
      success: true,
      data: {
        id: consent.id,
        consent_type: consent.consent_type,
        granted: consent.granted,
        granted_at: consent.granted_at,
        purpose: consent.purpose,
        version_terms: consent.version_terms,
        explicit_authorization: consent.explicit_authorization,
        document_sha256: consent.document_sha256
      },
      message: 'Consentimiento biometrico otorgado correctamente'
    });
  } catch (error) {
    console.error('Error POST /consent/biometric:', error.message);
    res.status(500).json({ 
      error: 'internal_error', 
      message: 'Error otorgando consentimiento' 
    });
  }
});

/**
 * @route DELETE /api/consent/biometric/:consentType
 * @description Revoca consentimiento biometrico (derecho de supresion)
 * @access Private
 * @returns {Object} Consentimiento revocado
 */
router.delete('/biometric/:consentType', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { consentType } = req.params;
    
    if (!VALID_CONSENT_TYPES.includes(consentType)) {
      return res.status(400).json({
        error: 'invalid_consent_type',
        message: 'Tipo de consentimiento invalido. Validos: ' + VALID_CONSENT_TYPES.join(', ')
      });
    }
    
    const consent = await revokeConsent(userId, consentType);
    
    res.json({
      success: true,
      data: {
        id: consent.id,
        consent_type: consent.consent_type,
        granted: consent.granted,
        revoked_at: consent.revoked_at
      },
      message: 'Consentimiento revocado. Ahora puede solicitar eliminacion de sus datos biometricos (derecho de supresion Art. 15 Ley 1581)'
    });
  } catch (error) {
    console.error('Error DELETE /consent/biometric/:type:', error.message);
    res.status(500).json({ 
      error: 'internal_error', 
      message: 'Error revocando consentimiento' 
    });
  }
});

/**
 * @route DELETE /api/consent/biometric/:consentType/data
 * @description Elimina datos biometricos tras revocacion (derecho de supresion Art. 15 Ley 1581)
 * @access Private
 * @returns {Object} Confirmacion de eliminacion
 */
router.delete('/biometric/:consentType/data', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { consentType } = req.params;
    
    if (!VALID_CONSENT_TYPES.includes(consentType)) {
      return res.status(400).json({
        error: 'invalid_consent_type',
        message: 'Tipo de consentimiento invalido. Validos: ' + VALID_CONSENT_TYPES.join(', ')
      });
    }
    
    const requestId = crypto.randomUUID();
    await pool.query(`INSERT INTO biometric_consent_audit
      (user_id, consent_id, request_id, event_type, consent_type, granted, state_after)
      VALUES ($1, 'DATA_PURGE', $2, 'SUPPRESSION_REQUESTED', 'all_biometric', FALSE, $3::jsonb)`,
    [userId, requestId, JSON.stringify({ requested_consent_type: consentType })]);

    const result = await deleteBiometricData(userId, consentType);

    // N-11 (SECAPP-05): la supresión es fail-closed. Si la implementación no
    // CONFIRMA el borrado (`deleted !== true`, p.ej. {deleted:false,
    // recordsAffected:0} por error de BD), NUNCA se responde éxito: el titular
    // creería ejercido su derecho de supresión (Ley 1581 Art. 8/15) sin serlo.
    // Sin este guard la ruta respondía 200 {success:true} con "eliminados
    // permanentemente" aunque el borrado hubiera fallado.
    if (!result || result.deleted !== true) {
      await pool.query(`INSERT INTO biometric_consent_audit
        (user_id, consent_id, request_id, event_type, consent_type, granted, state_after)
        VALUES ($1, 'DATA_PURGE', $2, 'SUPPRESSION_FAILED', 'all_biometric', FALSE, $3::jsonb)`,
      [userId, requestId, JSON.stringify({ reason: 'deletion_not_confirmed' })]);
      return res.status(500).json({
        error: 'deletion_failed',
        message: (result && result.error) || 'No se pudo confirmar la supresion de los datos biometricos'
      });
    }

    await pool.query(`INSERT INTO biometric_consent_audit
      (user_id, consent_id, request_id, event_type, consent_type, granted, state_after)
      VALUES ($1, 'DATA_PURGE', $2, 'SUPPRESSION_COMPLETED', 'all_biometric', FALSE, $3::jsonb)`,
    [userId, requestId, JSON.stringify({ records_affected: result.recordsAffected })]);

    res.json({
      success: true,
      data: result,
      request_id: requestId,
      message: 'Datos biometricos eliminados permanentemente (derecho de supresion Art. 15 Ley 1581)'
    });
  } catch (error) {
    console.error('Error DELETE /consent/biometric/:type/data:', error.message);
    res.status(500).json({ 
      error: 'internal_error', 
      message: error.message || 'Error eliminando datos biometricos' 
    });
  }
});

/**
 * @route GET /api/consent/access-logs
 * @description Obtiene logs de acceso a datos biometricos (auditoria)
 * @access Private (Admin o usuario propio)
 * @query { startDate, endDate, accessType }
 * @returns {Array} Logs de acceso
 */
router.get('/access-logs', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { startDate, endDate, accessType } = req.query;
    
    // Solo admin puede ver logs de otros usuarios
    const isAdmin = req.user.rol === 'ADMIN';
    const targetUserId = isAdmin && req.query.userId ? req.query.userId : userId;
    
    const logs = await getAccessLogs({
      userId: targetUserId,
      startDate,
      endDate,
      accessType
    });
    
    res.json({
      success: true,
      data: logs,
      count: logs.length
    });
  } catch (error) {
    console.error('Error GET /consent/access-logs:', error.message);
    res.status(500).json({ 
      error: 'internal_error', 
      message: 'Error obteniendo logs de acceso' 
    });
  }
});

/** Dashboard API: resumen sin datos identificables directos. Solo ADMIN. */
router.get('/audit/summary', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const from = parseAuditDate(req.query.from) || new Date(Date.now() - 30 * 86400000).toISOString();
    const to = parseAuditDate(req.query.to) || new Date().toISOString();
    if (req.query.from && !parseAuditDate(req.query.from) || req.query.to && !parseAuditDate(req.query.to)) {
      return res.status(400).json({ error: 'invalid_date', message: 'Usa fechas ISO-8601 válidas en from y to.' });
    }
    if (new Date(from) > new Date(to)) return res.status(400).json({ error: 'invalid_range', message: 'from debe ser anterior o igual a to.' });

    const [events, active, outdated, missingEvidence, integrity] = await Promise.all([
      pool.query(`SELECT event_type, COUNT(*)::int AS count
        FROM biometric_consent_audit WHERE happened_at >= $1 AND happened_at <= $2
        GROUP BY event_type ORDER BY event_type`, [from, to]),
      pool.query(`SELECT COUNT(*)::int AS count FROM biometric_consents
        WHERE consent_type = 'facial_analysis' AND granted = TRUE AND revoked_at IS NULL
          AND version_terms = $1 AND explicit_authorization = TRUE AND document_sha256 IS NOT NULL`, [BIOMETRIC_CONSENT_VERSION]),
      pool.query(`SELECT COUNT(*)::int AS count FROM biometric_consents
        WHERE consent_type = 'facial_analysis' AND granted = TRUE AND revoked_at IS NULL
          AND version_terms <> $1`, [BIOMETRIC_CONSENT_VERSION]),
      pool.query(`SELECT COUNT(*)::int AS count FROM biometric_consents
        WHERE consent_type = 'facial_analysis' AND granted = TRUE AND revoked_at IS NULL
          AND (explicit_authorization IS DISTINCT FROM TRUE OR document_sha256 IS NULL)`, []),
      pool.query(`SELECT COUNT(*)::int AS count, MIN(happened_at) AS first_event,
          MAX(happened_at) AS last_event
        FROM biometric_consent_audit`),
    ]);
    await logBiometricAccess({
      userId: req.user.id,
      accessedBy: 'admin',
      accessType: 'read_consent_audit_summary',
      ip: req.ip,
      details: { from, to },
    });
    res.json({
      success: true,
      data: {
        generated_at: new Date().toISOString(),
        period: { from, to },
        current_terms_version: BIOMETRIC_CONSENT_VERSION,
        active_current_consents: active.rows[0].count,
        active_outdated_consents_requiring_renewal: outdated.rows[0].count,
        active_consents_missing_explicit_evidence: missingEvidence.rows[0].count,
        events_by_type: events.rows,
        audit_source: {
          table: 'biometric_consent_audit',
          append_only_trigger: 'trg_biometric_consent_audit_immutable',
          total_events: integrity.rows[0].count,
          first_event_at: integrity.rows[0].first_event,
          last_event_at: integrity.rows[0].last_event,
        },
      },
    });
  } catch (error) {
    console.error('Error GET /consent/audit/summary:', error.message);
    res.status(500).json({ error: 'audit_unavailable', message: 'No se pudo consultar el resumen de auditoría.' });
  }
});

/**
 * Dashboard API: eventos paginados y evidencia del texto consentido.
 * No devuelve IP, correo ni user-agent; el identificador del titular es un HMAC
 * estable con la clave del servidor. El parámetro user_id solo filtra y nunca se
 * devuelve en la respuesta.
 */
router.get('/audit/events', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const from = parseAuditDate(req.query.from);
    const to = parseAuditDate(req.query.to);
    if (req.query.from && !from || req.query.to && !to) {
      return res.status(400).json({ error: 'invalid_date', message: 'Usa fechas ISO-8601 válidas en from y to.' });
    }
    if (from && to && new Date(from) > new Date(to)) return res.status(400).json({ error: 'invalid_range', message: 'from debe ser anterior o igual a to.' });

    const eventType = req.query.event_type ? String(req.query.event_type) : null;
    const consentType = req.query.consent_type ? String(req.query.consent_type) : null;
    if (eventType && !['GRANTED', 'REVOKED', 'AMENDED', 'CONSENT_RECORD_DELETED', 'SUPPRESSION_REQUESTED', 'SUPPRESSION_COMPLETED', 'SUPPRESSION_FAILED'].includes(eventType)) {
      return res.status(400).json({ error: 'invalid_event_type' });
    }
    if (consentType && !VALID_CONSENT_TYPES.includes(consentType)) return res.status(400).json({ error: 'invalid_consent_type' });
    const userId = req.query.user_id === undefined ? null : Number(req.query.user_id);
    if (userId !== null && (!Number.isSafeInteger(userId) || userId <= 0)) return res.status(400).json({ error: 'invalid_user_id' });
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100);
    const offset = Math.min(Math.max(Number.parseInt(req.query.offset, 10) || 0, 0), 100000);
    const filters = { from, to, eventType, consentType, userId };

    let where = ' WHERE 1=1';
    const countParams = [];
    where = applyAuditFilters(where, countParams, filters, { allowSubject: true });
    const count = await pool.query(`SELECT COUNT(*)::int AS count FROM biometric_consent_audit${where}`, countParams);
    const params = [...countParams, limit, offset];
    const rows = await pool.query(`SELECT id, consent_id, event_type, consent_type,
        granted, granted_at, revoked_at, purpose, version_terms,
        explicit_authorization, document_sha256, terms_snapshot,
        happened_at, state_before, state_after, user_id
      FROM biometric_consent_audit${where}
      ORDER BY happened_at DESC, id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`, params);

    await logBiometricAccess({
      userId: req.user.id,
      accessedBy: 'admin',
      accessType: 'read_consent_audit_events',
      ip: req.ip,
      details: { from, to, eventType, consentType, filtered_by_user_id: userId !== null, limit, offset },
    });

    res.json({
      success: true,
      data: rows.rows.map(({ user_id, ...event }) => ({ ...event, subject_ref: auditSubjectRef(user_id) })),
      pagination: { total: count.rows[0].count, limit, offset, next_offset: offset + rows.rows.length < count.rows[0].count ? offset + rows.rows.length : null },
      filters: { from, to, event_type: eventType, consent_type: consentType },
    });
  } catch (error) {
    console.error('Error GET /consent/audit/events:', error.message);
    res.status(500).json({ error: 'audit_unavailable', message: 'No se pudieron consultar los eventos de auditoría.' });
  }
});

/**
 * @route GET /api/consent/terms
 * @description Obtiene los terminos y condiciones actuales para consentimiento biometrico
 * @access Public
 * @returns {Object} Terminos y version
 */
router.get('/terms', async (req, res) => {
  try {
    const terms = currentTermsDocument();
    res.json({
      success: true,
      data: { ...terms.data, document_sha256: terms.document_sha256 }
    });
  } catch (error) {
    console.error('Error GET /consent/terms:', error.message);
    res.status(500).json({ 
      error: 'internal_error', 
      message: 'Error obteniendo terminos' 
    });
  }
});

wrapRouterAsync(router);
module.exports = router;

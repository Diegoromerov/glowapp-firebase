const { wrapRouterAsync } = require('../utils/expressAsync');
/**
 * backend/src/routes/consentRoutes.js
 * Rutas API para gestión de consentimientos biométricos
 * Cumple Ley 1581/2012: derechos de acceso, actualización, rectificación, supresión
 */

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { pool } = require('../config/db');
const { 
  checkConsent,
  grantConsent,
  revokeConsent,
  getConsentHistory,
  deleteBiometricData,
  validateConsentBeforeProcessing,
  VALID_CONSENT_TYPES
} = require('../services/consentService');

/**
 * @route POST /api/consent/grant
 * @description Otorga consentimiento biométrico
 * @access Private (JWT required)
 * @body { consent_type, purpose }
 * @returns { granted: true, consent_id, granted_at }
 */
router.post('/grant', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { consent_type, purpose } = req.body;
    
    // Validaciones
    if (!consent_type || !['facial_analysis', 'skin_scan', 'hair_analysis', 'body_measurement', 'virtual_try_on', 'all_biometric'].includes(consent_type)) {
      return res.status(400).json({
        error: 'invalid_consent_type',
        message: 'Tipo de consentimiento requerido y debe ser uno de: facial_analysis, skin_scan, hair_analysis, body_measurement, virtual_try_on, all_biometric'
      });
    }
    
    if (!purpose || purpose.trim().length < 10) {
      return res.status(400).json({
        error: 'invalid_purpose',
        message: 'La finalidad (purpose) es requerida y debe tener al menos 10 caracteres'
      });
    }
    
    const consent = await grantConsent({
      userId,
      consentType: consent_type,
      purpose: purpose.trim(),
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });
    
    res.status(201).json({
      granted: true,
      consent_id: consent.id,
      granted_at: consent.granted_at
    });
  } catch (error) {
    console.error('❌ Error POST /api/consent/grant:', error.message);
    res.status(500).json({ 
      error: 'internal_error', 
      message: 'Error otorgando consentimiento' 
    });
  }
});

/**
 * @route POST /api/consent/revoke
 * @description Revoca consentimiento biométrico
 * @access Private (JWT required)
 * @body { consent_type }
 * @returns { revoked: true, revoked_at }
 */
router.post('/revoke', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { consent_type } = req.body;
    
    if (!consent_type || !['facial_analysis', 'skin_scan', 'hair_analysis', 'body_measurement', 'virtual_try_on', 'all_biometric'].includes(consent_type)) {
      return res.status(400).json({
        error: 'invalid_consent_type',
        message: 'Tipo de consentimiento requerido y debe ser uno de: facial_analysis, skin_scan, hair_analysis, body_measurement, virtual_try_on, all_biometric'
      });
    }
    
    const revoked = await revokeConsent(userId, consent_type);
    
    if (!revoked) {
      return res.status(404).json({
        error: 'not_found',
        message: 'No se encontró consentimiento activo para revocar'
      });
    }
    
    res.json({
      revoked: true,
      revoked_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error POST /api/consent/revoke:', error.message);
    res.status(500).json({ 
      error: 'internal_error', 
      message: 'Error revocando consentimiento' 
    });
  }
});

/**
 * @route GET /api/consent/status
 * @description Retorna todos los consentimientos del usuario
 * @access Private (JWT required)
 * @returns { consents: [{ type, granted, granted_at, purpose }] }
 */
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const history = await getConsentHistory(userId);
    
    const consents = history.map(c => ({
      type: c.consent_type,
      granted: c.granted,
      granted_at: c.granted_at,
      purpose: c.purpose,
      version: c.version_terms,
      revoked_at: c.revoked_at
    }));
    
    res.json({
      success: true,
      consents
    });
  } catch (error) {
    console.error('❌ Error GET /api/consent/status:', error.message);
    res.status(500).json({ 
      error: 'internal_error', 
      message: 'Error obteniendo estado de consentimientos' 
    });
  }
});

/**
 * @route GET /api/consent/history
 * @description Retorna historial completo (para derecho de acceso)
 * @access Private (JWT required)
 * @returns { history: [...] }
 */
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const history = await getConsentHistory(userId);
    
    res.json({
      success: true,
      history
    });
  } catch (error) {
    console.error('❌ Error GET /api/consent/history:', error.message);
    res.status(500).json({ 
      error: 'internal_error', 
      message: 'Error obteniendo historial de consentimientos' 
    });
  }
});

/** Exporta los datos biométricos propios del usuario autenticado. */
router.get('/export', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const [consents, profiles, diagnostics, userBiometrics, history, skinProfiles] = await Promise.all([
      pool.query('SELECT consent_type, granted, granted_at, revoked_at, purpose, version_terms, created_at FROM biometric_consents WHERE user_id = $1 ORDER BY created_at', [userId]),
      pool.query('SELECT id, face_scores, hands_diagnosis, recommendation, recommended_products, entry_point, created_at, updated_at FROM beauty_profiles WHERE user_id = $1', [userId]),
      pool.query('SELECT id, tool_type, result_data, score_hidratacion, score_impurezas, score_luminosidad, track, created_at FROM ai_diagnostics WHERE user_id = $1 ORDER BY created_at', [userId]),
      pool.query('SELECT id, subtono, estacion, paleta, hidratacion, sebo, mensaje_aura, created_at FROM user_biometrics WHERE user_id = $1 ORDER BY created_at', [String(userId)]),
      pool.query('SELECT id, profile_id, face_scores, hands_diagnosis, recommendation, created_at FROM biometric_history WHERE user_id = $1 ORDER BY created_at', [userId]),
      pool.query('SELECT id, tipo_piel, hidratacion_promedio, tendencia_acne, sensibilidad_score, diagnosticos_count, ultimo_diagnostico_at, created_at, updated_at FROM skin_profiles WHERE user_id = $1', [userId]),
    ]);

    res.json({
      exported_at: new Date().toISOString(),
      user_id: userId,
      consents: consents.rows,
      beauty_profiles: profiles.rows,
      ai_diagnostics: diagnostics.rows,
      user_biometrics: userBiometrics.rows,
      biometric_history: history.rows,
      skin_profiles: skinProfiles.rows,
    });
  } catch (error) {
    console.error('❌ Error exportando datos biométricos:', error.message);
    res.status(500).json({ error: 'export_failed', message: 'No se pudieron exportar los datos biométricos.' });
  }
});

/**
 * @route DELETE /api/consent/data
 * @description Elimina todos los datos biométricos (derecho de supresión)
 * @access Private (JWT required)
 * @returns { deleted: true, records_affected: N }
 */
router.delete('/data', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await deleteBiometricData(userId);
    
    // N-11 (SECAPP-05): confirmación explícita de borrado. `!result.deleted`
    // aceptaba cualquier valor falsy, pero el contrato es que solo
    // `deleted === true` autoriza responder éxito; ante fallo de BD el
    // servicio devuelve {deleted:false, recordsAffected:0} y el cliente debe
    // recibir 500, no una supresión ficticia (Ley 1581 Art. 8/15).
    if (!result || result.deleted !== true) {
      return res.status(500).json({
        error: 'deletion_failed',
        message: (result && result.error) || 'Error eliminando datos biométricos'
      });
    }
    
    res.json({
      deleted: true,
      records_affected: result.recordsAffected
    });
  } catch (error) {
    console.error('❌ Error DELETE /api/consent/data:', error.message);
    res.status(500).json({ 
      error: 'internal_error', 
      message: 'Error eliminando datos biométricos' 
    });
  }
});

/**
 * @route GET /api/consent/policy
 * @description Retorna la política de tratamiento de datos
 * @access Public (sin auth)
 * @returns { policy_url, version, last_updated, contact_email }
 */
router.get('/policy', async (req, res) => {
  try {
    res.json({
      policy_url: '/api/consent/policy',
      version: '1.0',
      last_updated: '2026-08-05',
      contact_email: 'privacidad@glowapp.com',
      responsible_entity: 'GlowApp SAS',
      nit: '901.234.567-8',
      address: 'Carrera 7 # 71-21, Bogotá, Colombia',
      phone: '+57 1 744 0000'
    });
  } catch (error) {
    console.error('❌ Error GET /api/consent/policy:', error.message);
    res.status(500).json({ 
      error: 'internal_error', 
      message: 'Error obteniendo política de privacidad' 
    });
  }
});

wrapRouterAsync(router);
module.exports = router;

const { wrapRouterAsync } = require('../utils/expressAsync');
// backend/src/routes/biometricRoutes.js
const express = require('express');
const router = express.Router();
const orchestrator = require('../services/biometric/orchestrator');
const profileService = require('../services/biometric/profile.service');
const scanComparisonService = require('../services/biometric/scanComparison.service');
const historyService = require('../services/biometric/history.service');
const { authMiddleware } = require('../middleware/auth');
const idempotencyMiddleware = require('../middleware/idempotency');
const biometricConsentGuard = require('../middleware/biometricConsentGuard');
const { biometricAnalyzeSchema, biometricProfileParamSchema } = require('../schemas/biometric.schema');

/**
 * POST /api/biometric/analyze
 * ADR-001 Compliance:
 * - Checklist Item 1: Guard de Consentimiento biométrico inmutable.
 * - Checklist Item 3: Validación Zod obligatoria en endpoints mutantes.
 * - Checklist Item 4: Eliminación de userId || 'guest' (Exigencia de JWT válido).
 * - Checklist Item 5: Header Idempotency-Key obligatorio.
 *
 * Y-F4: el cuerpo acepta `geometry` opcional { yaw, roll, pitch?, faceRatio?,
 * aspectRatio?, centerOffset? } medida por el cliente con ML Kit. Se revalida aquí
 * (captureGeometry.service) antes de llamar al proveedor: un rostro girado,
 * inclinado o fuera de distancia responde 422 CAPTURE_REJECTED con el motivo y no
 * gasta unidades. Ausente = se mide igual, marcado como `SIN_GEOMETRIA`; con
 * BIOMETRIC_REQUIRE_GEOMETRY=true la ausencia también es rechazo.
 * (El endpoint no tiene requestBody explícito en openapi.json: sigue siendo un stub
 * autodescubierto, así que el campo no aparece en el spec generado.)
 */
// DECISION 2026-10-09 (Diego): la validacion Zod va ANTES del veto de consentimiento.
// Antes el guard corria primero y respondia 403 a un cuerpo mal formado: se evaluaba
// autorizacion sobre una peticion que ni siquiera era valida. Un cuerpo invalido es un error
// del cliente (400) y debe reportarse antes de mirar permisos; el 403 queda para el caso
// bien formado y sin consentimiento valido.
const validateBiometricAnalyze = (req, res, next) => {
  const parsed = biometricAnalyzeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Datos de analisis biometrico invalidos',
      details: parsed.error.issues,
    });
  }
  req.body = parsed.data;
  next();
};

router.post('/analyze', authMiddleware, idempotencyMiddleware, validateBiometricAnalyze, biometricConsentGuard, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Se requiere una sesión de usuario autenticada válida.',
    });
  }

  console.log(`📥 [BIOMETRIC] Request recibida en POST /analyze - IP: ${req.ip}, User ID JWT: ${userId}`);

  // Validación Zod de entrada
  if (req.method === 'POST' && !req.headers['idempotency-key'] && !req.headers['x-idempotency-key']) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', code: 'MISSING_IDEMPOTENCY_KEY', message: 'El encabezado Idempotency-Key es obligatorio para el análisis biométrico.' });
  }
  const parseResult = biometricAnalyzeSchema.safeParse(req.body);
  if (!parseResult.success) {
    const errorDetails = parseResult.error.errors.map(e => e.message).join(', ');
    console.warn(`⚠️ [BIOMETRIC] Error de validación Zod en /analyze: ${errorDetails}`);
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: errorDetails,
      details: parseResult.error.format(),
    });
  }

  const { faceImage, handsImage, entryPoint, lat, lng, geometry } = parseResult.data;

  // Validar tamaño de payload base64 (máx 20MB por imagen)
  const faceSize = Buffer.from(faceImage, 'base64').length;
  const handsSize = handsImage ? Buffer.from(handsImage, 'base64').length : 0;

  if (faceSize > 20 * 1024 * 1024 || handsSize > 20 * 1024 * 1024) {
    return res.status(400).json({
      error: 'PAYLOAD_TOO_LARGE',
      message: 'Las imágenes no pueden superar el tamaño límite de 20MB por archivo.',
    });
  }

  const faceBuffer = Buffer.from(faceImage, 'base64');
  const handsBuffer = handsImage ? Buffer.from(handsImage, 'base64') : null;
  try {
    const traceId = req.headers['x-trace-id'] || req.headers['x-request-id'] || `bio-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    const result = await orchestrator.analyze(
      userId,
      faceBuffer,
      handsBuffer,
      entryPoint || 'ideas',
      lat,
      lng,
      traceId,
      // Y-F4: geometría medida por el cliente; el orquestador la revalida antes de
      // llamar al proveedor y la guarda con la sesión.
      geometry || null
    );

    faceBuffer.fill(0);
    if (handsBuffer) handsBuffer.fill(0);

    res.status(201).json({
      success: true,
      profileId: result.profileId,
      results: {
        face: result.face,
        glowScore: result.glowScore,
        dermoFamilies: result.dermoFamilies,
        hands: result.hands,
        recommendation: result.recommendation,
        keyIngredients: result.keyIngredients,
        vtoTones: result.vtoTones,
        delta: result.delta,
        consent: result.consent,
        cache: result.cache,
      },
      createdAt: result.createdAt,
    });
  } catch (error) {
    console.error('❌ Error en el orquestador biométrico:', error.message);
    if (typeof faceBuffer !== 'undefined') faceBuffer.fill(0);
    if (typeof handsBuffer !== 'undefined' && handsBuffer) handsBuffer.fill(0);
    if (error.code === 'BIOMETRIC_ANALYSIS_UNAVAILABLE' || error.statusCode === 503) {
      return res.status(503).json({ success: false, error: 'AI_UNAVAILABLE', message: error.message });
    }
    // Y-F2: la foto no sirve para medir. Se responde 422 con el motivo medido y no se
    // gastó ninguna unidad del proveedor.
    if (error.code === 'CAPTURE_REJECTED' || error.statusCode === 422) {
      return res.status(422).json({
        success: false,
        error: 'CAPTURE_REJECTED',
        message: error.message,
        capture: error.details || null,
      });
    }
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Error al procesar el análisis biométrico. Por favor intenta nuevamente.',
    });
  }
});

/**
 * GET /api/biometric/delta/latest
 * Y-F3: última comparación del usuario contra su propio baseline.
 * No calcula: lee la comparación ya persistida cuando se hizo el escaneo.
 */
router.get('/delta/latest', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Se requiere una sesión autenticada.' });
    }

    const latest = await scanComparisonService.getLatest(parseInt(userId, 10));
    if (!latest) {
      return res.status(404).json({
        success: false,
        error: 'NO_COMPARISONS',
        message: 'Todavía no hay comparaciones: se necesitan al menos dos escaneos.',
      });
    }

    res.json({ success: true, delta: latest });
  } catch (error) {
    console.error('❌ Error en GET /api/biometric/delta/latest:', error.message);
    res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'No se pudo obtener la comparación.' });
  }
});

/**
 * GET /api/biometric/history
 * Y-F6: la serie completa del usuario, más reciente primero.
 * No recalcula: lee el GlowScore guardado con cada sesión y el veredicto persistido
 * de cada comparación. Un usuario sin escaneos recibe una lista vacía, no un 404.
 */
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Se requiere una sesión autenticada.' });
    }

    const { scans, limit } = await historyService.list(userId, { limit: req.query.limit });

    res.json({ success: true, scans, total: scans.length, limit });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ success: false, error: 'INVALID_USER', message: error.message });
    }
    console.error('❌ Error en GET /api/biometric/history:', error.message);
    res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'No se pudo obtener el historial.' });
  }
});

/**
 * GET /api/biometric/profile/:userId
 * ADR-001 Compliance: JWT estricto y validación de parámetros con Zod.
 */
router.get('/profile/:userId', authMiddleware, async (req, res) => {
  const parseResult = biometricProfileParamSchema.safeParse(req.params);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'INVALID_USER_ID', message: 'El identificador de usuario es inválido.' });
  }

  const { userId } = parseResult.data;

  // Validar que el usuario solo consulte su propio perfil salvo permisos de admin
  if (req.user?.id !== userId && req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'No tienes permisos para acceder a este perfil.' });
  }

  try {
    const profile = await profileService.getProfile(parseInt(userId, 10));
    if (!profile) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Perfil biométrico no encontrado.' });
    }
    res.json(profile);
  } catch (error) {
    console.error('❌ Error obteniendo perfil biométrico:', error.message);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Error al obtener el perfil biométrico.' });
  }
});

/**
 * DELETE /api/biometric/profile/:userId
 * ADR-001 Compliance: Aplicación de Habeas Data / Derecho al Olvido bajo JWT.
 */
router.delete('/profile/:userId', authMiddleware, async (req, res) => {
  const parseResult = biometricProfileParamSchema.safeParse(req.params);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'INVALID_USER_ID', message: 'El identificador de usuario es inválido.' });
  }

  const { userId } = parseResult.data;

  if (req.user?.id !== userId && req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'No tienes permisos para eliminar este perfil.' });
  }

  try {
    await profileService.deleteProfile(parseInt(userId, 10));
    res.json({ success: true, message: 'Perfil biométrico eliminado correctamente (Habeas Data aplicado).' });
  } catch (error) {
    console.error('❌ Error eliminando perfil biométrico:', error.message);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Error al eliminar el perfil biométrico.' });
  }
});

wrapRouterAsync(router);
module.exports = router;


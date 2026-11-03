const { wrapRouterAsync } = require('../../utils/expressAsync');
// backend/src/routes/v1/beautyRoutes.js
// Version 1.0 of Beauty API endpoints with JSON Schema validation
const express = require('express');
const router = express.Router();
const orchestrator = require('../../services/biometric/orchestrator');
const profileService = require('../../services/biometric/profile.service');
const { authMiddleware } = require('../../middleware/auth');
const idempotencyMiddleware = require('../../middleware/idempotency');
const biometricConsentGuard = require('../../middleware/biometricConsentGuard');
const { biometricAnalyzeSchema, biometricProfileParamSchema } = require('../../schemas/biometric.schema');
const { v4: uuidv4 } = require('uuid');
const LoggerHelper = require('../../helpers/logger');

/**
 * @swagger
 * components:
 *   schemas:
 *     BiometricAnalysisResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         traceId:
 *           type: string
 *           format: uuid
 *           example: "550e8400-e29b-41d4-a716-446655440000"
 *         profileId:
 *           type: integer
 *           example: 123
 *         results:
 *           type: object
 *           properties:
 *             face:
 *               type: object
 *               properties:
 *                 hydration:
 *                   type: number
 *                   minimum: 0
 *                   maximum: 100
 *                   example: 65
 *                 wrinkles:
 *                   type: number
 *                   minimum: 0
 *                   maximum: 100
 *                   example: 25
 *                 spots:
 *                   type: number
 *                   minimum: 0
 *                   maximum: 100
 *                   example: 30
 *                 pores:
 *                   type: number
 *                   minimum: 0
 *                   maximum: 100
 *                   example: 40
 *                 subtono:
 *                   type: string
 *                   enum: ['calido', 'frio', 'neutro']
 *                   example: "calido"
 *                 bioAge:
 *                   type: integer
 *                   minimum: 0
 *                   maximum: 120
 *                   example: 30
 *             hands:
 *               type: object
 *               properties:
 *                 manchasSolares:
 *                   type: string
 *                   enum: ['ninguna', 'leve', 'moderada', 'severa']
 *                   example: "leve"
 *                 sequedad:
 *                   type: string
 *                   enum: ['ninguna', 'leve', 'moderada', 'severa']
 *                   example: "leve"
 *                 cuticulas:
 *                   type: string
 *                   enum: ['sanas', 'dañadas']
 *                   example: "sanas"
 *                 unas:
 *                   type: string
 *                   enum: ['sanas', 'dañadas']
 *                   example: "sanas"
 *                 edadAparente:
 *                   type: integer
 *                   minimum: 0
 *                   maximum: 120
 *                   example: 35
 *             recommendation:
 *               type: string
 *               example: "Usar hidratante facial con SPF 30 por la mañana"
 *             keyIngredients:
 *               type: array
 *               items:
 *                 type: string
 *               example: ["ácido hialurónico", "vitamina c"]
 *             vtoTones:
 *               type: array
 *               items:
 *                 type: string
 *               example: ["#FF5733", "#33FF57"]
 *             createdAt:
 *               type: string
 *               format: date-time
 *               example: "2026-08-31T10:30:00Z"
 *     BiometricProfileResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         traceId:
 *           type: string
 *           format: uuid
 *           example: "550e8400-e29b-41d4-a716-446655440000"
 *         userId:
 *           type: integer
 *           example: 123
 *         faceScores:
 *           type: object
 *         handsDiagnosis:
 *           type: object
 *         recommendation:
 *           type: string
 *         keyIngredients:
 *           type: array
 *           items:
 *             type: string
 *         vtoTones:
 *           type: array
 *           items:
 *             type: string
 *         entryPoint:
 *           type: string
 *           enum: ['ideas', 'vto', 'scanner', 'other']
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         traceId:
 *           type: string
 *           format: uuid
 *         error:
 *           type: string
 *           enum: ['VALIDATION_ERROR', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'INTERNAL_ERROR', 'PAYLOAD_TOO_LARGE']
 *         message:
 *           type: string
 */

/**
 * POST /v1/beauty/analyze
 * Version 1.0 endpoint for biometric analysis with JSON Schema validation
 */
router.post('/analyze', authMiddleware, idempotencyMiddleware, biometricConsentGuard, async (req, res) => {
  const traceId = uuidv4();
  const userId = req.user?.id;
  
  if (!userId) {
    return res.status(401).json({
      success: false,
      traceId,
      error: 'UNAUTHORIZED',
      message: 'Se requiere una sesión de usuario autenticada válida.',
    });
  }

  LoggerHelper.info(`Request recibida en POST /analyze - IP: ${req.ip}, User ID JWT: ${userId}, TraceId: ${traceId}`, req);

  // Validación Zod de entrada
  const parseResult = biometricAnalyzeSchema.safeParse(req.body);
  if (!parseResult.success) {
    const errorDetails = parseResult.error.errors.map(e => e.message).join(', ');
    console.warn(`⚠️ [BEAUTY V1] Error de validación Zod en /analyze: ${errorDetails}`);
    return res.status(400).json({
      success: false,
      traceId,
      error: 'VALIDATION_ERROR',
      message: errorDetails,
      details: parseResult.error.format(),
    });
  }

  const { faceImage, handsImage, entryPoint, lat, lng } = parseResult.data;

  // Validar tamaño de payload base64 (máx 20MB por imagen)
  const faceSize = Buffer.from(faceImage, 'base64').length;
  const handsSize = handsImage ? Buffer.from(handsImage, 'base64').length : 0;

  if (faceSize > 20 * 1024 * 1024 || handsSize > 20 * 1024 * 1024) {
    return res.status(400).json({
      success: false,
      traceId,
      error: 'PAYLOAD_TOO_LARGE',
      message: 'Las imágenes no pueden superar el tamaño límite de 20MB por archivo.',
    });
  }

  const faceBuffer = Buffer.from(faceImage, 'base64');
  const handsBuffer = handsImage ? Buffer.from(handsImage, 'base64') : null;
  try {

    const result = await orchestrator.analyze(
      userId,
      faceBuffer,
      handsBuffer,
      entryPoint || 'ideas',
      lat,
      lng
    );

    faceBuffer.fill(0);
    if (handsBuffer) handsBuffer.fill(0);
    res.status(201).json({
      success: true,
      traceId,
      profileId: result.profileId,
      results: {
        face: result.face,
        hands: result.hands,
        recommendation: result.recommendation,
        keyIngredients: result.keyIngredients,
        vtoTones: result.vtoTones,
      },
      createdAt: result.createdAt,
    });
  } catch (error) {
    console.error('❌ Error en el orquestador biométrico:', error.message);
    faceBuffer.fill(0);
    if (handsBuffer) handsBuffer.fill(0);
    res.status(error.statusCode === 503 ? 503 : 500).json({
      success: false,
      traceId,
      error: error.statusCode === 503 ? 'AI_UNAVAILABLE' : 'INTERNAL_ERROR',
      message: 'Error al procesar el análisis biométrico. Por favor intenta nuevamente.',
    });
  }
});

/**
 * GET /v1/beauty/profile/:userId
 * Version 1.0 endpoint for retrieving biometric profile
 */
router.get('/profile/:userId', authMiddleware, async (req, res) => {
  const traceId = uuidv4();
  const parseResult = biometricProfileParamSchema.safeParse(req.params);
  if (!parseResult.success) {
    return res.status(400).json({
      success: false,
      traceId,
      error: 'INVALID_USER_ID',
      message: 'El identificador de usuario es inválido.',
    });
  }

  const { userId } = parseResult.data;

  // Validar que el usuario solo consulte su propio perfil salvo permisos de admin
  if (req.user?.id !== userId && req.user?.role !== 'admin') {
    return res.status(403).json({
      success: false,
      traceId,
      error: 'FORBIDDEN',
      message: 'No tienes permisos para acceder a este perfil.',
    });
  }

  try {
    const profile = await profileService.getProfile(parseInt(userId, 10));
    if (!profile) {
      return res.status(404).json({
        success: false,
        traceId,
        error: 'NOT_FOUND',
        message: 'Perfil biométrico no encontrado.',
      });
    }
    res.json({
      success: true,
      traceId,
      ...profile
    });
  } catch (error) {
    console.error('❌ Error obteniendo perfil biométrico:', error.message);
    res.status(500).json({
      success: false,
      traceId,
      error: 'INTERNAL_ERROR',
      message: 'Error al obtener el perfil biométrico.'
    });
  }
});

/**
 * DELETE /v1/beauty/profile/:userId
 * Version 1.0 endpoint for deleting biometric profile (Habeas Data)
 */
router.delete('/profile/:userId', authMiddleware, async (req, res) => {
  const traceId = uuidv4();
  const parseResult = biometricProfileParamSchema.safeParse(req.params);
  if (!parseResult.success) {
    return res.status(400).json({
      success: false,
      traceId,
      error: 'INVALID_USER_ID',
      message: 'El identificador de usuario es inválido.',
    });
  }

  const { userId } = parseResult.data;

  if (req.user?.id !== userId && req.user?.role !== 'admin') {
    return res.status(403).json({
      success: false,
      traceId,
      error: 'FORBIDDEN',
      message: 'No tienes permisos para eliminar este perfil.',
    });
  }

  try {
    await profileService.deleteProfile(parseInt(userId, 10));
    res.json({
      success: true,
      traceId,
      message: 'Perfil biométrico eliminado correctamente (Habeas Data aplicado).'
    });
  } catch (error) {
    console.error('❌ Error eliminando perfil biométrico:', error.message);
    res.status(500).json({
      success: false,
      traceId,
      error: 'INTERNAL_ERROR',
      message: 'Error al eliminar el perfil biométrico.'
    });
  }
});

wrapRouterAsync(router);
module.exports = router;

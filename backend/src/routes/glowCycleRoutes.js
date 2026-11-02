const { wrapRouterAsync } = require('../utils/expressAsync');
// backend/src/routes/glowCycleRoutes.js
const express = require('express');
const router = express.Router();
const glowCycleService = require('../services/glowCycleService');
const { authMiddleware, verifyToken } = require('../middleware/auth');
const logger = require('../config/logger');

/**
 * POST /api/glow-cycle/create
 * Inicia un nuevo Glow Cycle
 */
router.post('/create', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      cycleType,
      faceScores,
      handsDiagnosis,
      targetGoal,
      targetMetricKey,
      targetValue,
      durationDays,
      planSummary,
      amRoutine,
      pmRoutine,
      recommendedProducts,
      recommendedServices
    } = req.body;

    const result = await glowCycleService.createCycle({
      userId,
      cycleType,
      faceScores,
      handsDiagnosis,
      targetGoal,
      targetMetricKey,
      targetValue,
      durationDays,
      planSummary,
      amRoutine,
      pmRoutine,
      recommendedProducts,
      recommendedServices
    });

    res.status(201).json(result);
  } catch (error) {
    logger.error('Error al crear Glow Cycle:', error.message);
    res.status(500).json({ error: 'Fallo al iniciar el Glow Cycle', details: error.message });
  }
});

/**
 * GET /api/glow-cycle/active
 * Obtiene el ciclo activo actual del usuario autenticado
 */
router.get('/active', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const activeCycle = await glowCycleService.getActiveCycle(userId);

    if (!activeCycle) {
      return res.status(200).json({ hasActiveCycle: false, cycle: null });
    }

    res.status(200).json({ hasActiveCycle: true, cycle: activeCycle });
  } catch (error) {
    logger.error('Error al consultar ciclo activo:', error.message);
    res.status(500).json({ error: 'Fallo al consultar el ciclo activo', details: error.message });
  }
});

/**
 * POST /api/glow-cycle/:id/measurement
 * Registra una medición de re-escaneo y calcula el delta
 */
router.post('/:id/measurement', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const cycleId = req.params.id;
    const { measurementType, dayNumber, faceScores, handsDiagnosis } = req.body;

    const result = await glowCycleService.recordMeasurement({
      cycleId,
      userId,
      measurementType,
      dayNumber,
      faceScores,
      handsDiagnosis
    });

    res.status(200).json(result);
  } catch (error) {
    logger.error('Error al registrar medición:', error.message);
    res.status(500).json({ error: 'Fallo al registrar la medición', details: error.message });
  }
});

/**
 * POST /api/glow-cycle/:id/checkin
 * Registra cumplimiento diario de rutina
 */
router.post('/:id/checkin', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const cycleId = req.params.id;
    const { amCompleted, pmCompleted, notes } = req.body;

    const result = await glowCycleService.logCheckin(cycleId, userId, {
      amCompleted,
      pmCompleted,
      notes
    });

    res.status(200).json(result);
  } catch (error) {
    logger.error('Error al registrar check-in:', error.message);
    res.status(500).json({ error: 'Fallo al registrar el check-in', details: error.message });
  }
});

/**
 * POST /api/glow-cycle/:id/re-scan
 * Ejecuta el re-escaneo multimodal, calcula delta, aplica adherencia y adapta la rutina
 */
router.post('/:id/re-scan', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const cycleId = req.params.id;
    const { dayNumber, faceScores, handsDiagnosis } = req.body;

    const result = await glowCycleService.performRescan({
      cycleId,
      userId,
      dayNumber,
      faceScores,
      handsDiagnosis
    });

    res.status(200).json(result);
  } catch (error) {
    logger.error('Error en re-escaneo del Glow Cycle:', error.message);
    res.status(500).json({ error: 'Fallo al procesar el re-escaneo', details: error.message });
  }
});

/**
 * POST /api/glow-cycle/:id/graduate
 * Cierra formalmente un ciclo completado para avanzar al siguiente
 */
router.post('/:id/graduate', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const cycleId = req.params.id;
    const { nextGoal, nextMetricKey } = req.body;

    const result = await glowCycleService.graduateCycle(cycleId, userId, {
      nextGoal,
      nextMetricKey
    });

    res.status(200).json(result);
  } catch (error) {
    logger.error('Error al graduar Glow Cycle:', error.message);
    res.status(500).json({ error: 'Fallo al graduar el ciclo', details: error.message });
  }
});

wrapRouterAsync(router);
module.exports = router;

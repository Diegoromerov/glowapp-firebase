// backend/src/services/glowCycleService.js
const { pool } = require('../config/db');
const redisClient = require('../config/redis');
const biometricCryptoService = require('./biometricCryptoService');
const transformationEngine = require('./transformationEngine');
const atenaAgent = require('./agents/atenaAgent');
const chronosAgent = require('./agents/chronosAgent');
const logger = require('../config/logger');

const CYCLE_CACHE_TTL = 3600; // 1 hora en segundos

class GlowCycleService {
  /**
   * Crea un nuevo Glow Cycle a partir de un escaneo biométrico inicial (Baseline)
   */
  async createCycle({
    userId,
    cycleType = 'skin',
    faceScores,
    handsDiagnosis,
    targetGoal,
    targetMetricKey = 'hydration',
    targetValue = 75,
    durationDays = 30,
    planSummary,
    amRoutine = [],
    pmRoutine = [],
    recommendedProducts = [],
    recommendedServices = []
  }) {
    const parsedUserId = parseInt(userId, 10);
    logger.info('Iniciando creación de Glow Cycle', { userId: parsedUserId, cycleType, targetMetricKey });

    const transformationEngine = require('./transformationEngine');

    // Si no se pasaron rutinas manuales, el Transformation Engine genera el plan adaptativo
    let plan = {
      planSummary,
      amRoutine,
      pmRoutine,
      recommendedProducts,
      recommendedServices
    };

    if (!amRoutine || amRoutine.length === 0) {
      const generatedPlan = await transformationEngine.generateTransformationPlan({
        userId: parsedUserId,
        cycleType,
        faceScores,
        handsDiagnosis,
        targetGoal,
        targetMetricKey
      });
      plan.planSummary = generatedPlan.planSummary;
      plan.amRoutine = generatedPlan.amRoutine;
      plan.pmRoutine = generatedPlan.pmRoutine;
      plan.recommendedProducts = generatedPlan.recommendedProducts;
      plan.recommendedServices = generatedPlan.recommendedServices;
    }

    // Determinar valor baseline de la métrica objetivo
    const baselineValue = faceScores && faceScores[targetMetricKey] !== undefined
      ? parseFloat(faceScores[targetMetricKey])
      : 50.0;

    const currentVal = baselineValue;
    const goalText = targetGoal || `Mejorar ${targetMetricKey} de ${baselineValue} a ${targetValue} en ${durationDays} días`;
    const summary = plan.planSummary || `Plan de cuidado para optimización de ${targetMetricKey} con rutina personalizada.`;

    // 1. Insertar el Ciclo en base de datos
    const insertCycleQuery = `
      INSERT INTO glow_cycles (
        user_id, cycle_type, status, target_goal, target_metric_key,
        baseline_value, target_value, current_value, duration_days,
        plan_summary, am_routine, pm_routine, recommended_product_ids,
        recommended_service_ids, start_date, end_date
      )
      VALUES (
        $1, $2, 'active', $3, $4,
        $5, $6, $7, $8,
        $9, $10, $11, $12,
        $13, NOW(), NOW() + INTERVAL '${parseInt(durationDays, 10)} days'
      )
      RETURNING *;
    `;

    const cycleRes = await pool.query(insertCycleQuery, [
      parsedUserId,
      cycleType,
      goalText,
      targetMetricKey,
      baselineValue,
      parseFloat(targetValue),
      currentVal,
      parseInt(durationDays, 10),
      summary,
      JSON.stringify(plan.amRoutine),
      JSON.stringify(plan.pmRoutine),
      JSON.stringify(plan.recommendedProducts),
      JSON.stringify(plan.recommendedServices)
    ]);

    const cycle = cycleRes.rows[0];

    // 2. Registrar la Medición Baseline (Día 1)
    const encryptedScores = biometricCryptoService.encrypt({ faceScores, handsDiagnosis });
    const insertMeasurementQuery = `
      INSERT INTO glow_cycle_measurements (
        cycle_id, user_id, measurement_type, day_number, encrypted_scores, score_delta, ai_evaluation_notes
      )
      VALUES ($1, $2, 'baseline', 1, $3, $4, $5)
      RETURNING *;
    `;

    await pool.query(insertMeasurementQuery, [
      cycle.id,
      parsedUserId,
      encryptedScores,
      JSON.stringify({ [targetMetricKey]: 0 }),
      'Medición inicial (Baseline) registrada exitosamente.'
    ]);

    // 3. Invalidar / actualizar caché en Redis
    await this._cacheActiveCycle(parsedUserId, cycle);

    return {
      success: true,
      cycleId: cycle.id,
      cycleType: cycle.cycle_type,
      status: cycle.status,
      targetGoal: cycle.target_goal,
      baselineValue: parseFloat(cycle.baseline_value),
      targetValue: parseFloat(cycle.target_value),
      currentValue: parseFloat(cycle.current_value),
      durationDays: cycle.duration_days,
      amRoutine,
      pmRoutine,
      startDate: cycle.start_date,
      endDate: cycle.end_date
    };
  }

  /**
   * Obtiene el ciclo activo de un usuario
   */
  async getActiveCycle(userId) {
    const parsedUserId = parseInt(userId, 10);
    const cacheKey = `glow:active_cycle:${parsedUserId}`;

    try {
      if (redisClient && redisClient.isOpen) {
        const cached = await redisClient.get(cacheKey);
        if (cached) return JSON.parse(cached);
      }
    } catch (err) {
      logger.warn('Fallo leyendo caché de active cycle:', err.message);
    }

    const query = `
      SELECT * FROM glow_cycles
      WHERE user_id = $1 AND status IN ('active', 'reassessment_due')
      ORDER BY created_at DESC
      LIMIT 1;
    `;

    const res = await pool.query(query, [parsedUserId]);
    if (res.rows.length === 0) return null;

    const cycle = res.rows[0];

    // Consultar historial de mediciones (para visualización longitudinal)
    const measQuery = `
      SELECT id, measurement_type, day_number, score_delta, ai_evaluation_notes, created_at
      FROM glow_cycle_measurements
      WHERE cycle_id = $1
      ORDER BY day_number ASC;
    `;
    const measRes = await pool.query(measQuery, [cycle.id]);
    cycle.measurements = measRes.rows;

    // Evaluar continuidad temporal con Chronos
    cycle.continuity = chronosAgent.evaluateCycleContinuity(cycle);

    await this._cacheActiveCycle(parsedUserId, cycle);
    return cycle;
  }

  /**
   * Registra una nueva medición durante el ciclo y calcula el progreso/delta
   */
  async recordMeasurement({
    cycleId,
    userId,
    measurementType = 'milestone_15d',
    dayNumber = 15,
    faceScores,
    handsDiagnosis
  }) {
    const parsedUserId = parseInt(userId, 10);
    logger.info('Registrando medición en Glow Cycle', { cycleId, userId: parsedUserId, dayNumber });

    // 1. Obtener ciclo actual
    const cycleRes = await pool.query('SELECT * FROM glow_cycles WHERE id = $1 AND user_id = $2;', [cycleId, parsedUserId]);
    if (cycleRes.rows.length === 0) {
      throw new Error('Glow Cycle no encontrado o no pertenece al usuario.');
    }

    const cycle = cycleRes.rows[0];
    const metricKey = cycle.target_metric_key || 'hydration';
    const baselineVal = parseFloat(cycle.baseline_value || 50);
    const newScoreVal = faceScores && faceScores[metricKey] !== undefined ? parseFloat(faceScores[metricKey]) : baselineVal;

    // 2. Calcular Delta
    const deltaVal = parseFloat((newScoreVal - baselineVal).toFixed(2));
    const scoreDelta = {
      [metricKey]: deltaVal,
      previous_baseline: baselineVal,
      current: newScoreVal
    };

    // 3. Generar evaluación con Atena
    const evaluationNotes = this.evaluateDelta(metricKey, deltaVal, newScoreVal, parseFloat(cycle.target_value));

    // 4. Guardar medición cifrada
    const encryptedScores = biometricCryptoService.encrypt({ faceScores, handsDiagnosis });
    const insertQuery = `
      INSERT INTO glow_cycle_measurements (
        cycle_id, user_id, measurement_type, day_number, encrypted_scores, score_delta, ai_evaluation_notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `;

    const measurementRes = await pool.query(insertQuery, [
      cycleId,
      parsedUserId,
      measurementType,
      parseInt(dayNumber, 10),
      encryptedScores,
      JSON.stringify(scoreDelta),
      evaluationNotes
    ]);

    // 5. Actualizar valor actual en el ciclo
    const nextStatus = dayNumber >= cycle.duration_days ? 'completed' : 'active';
    await pool.query(
      'UPDATE glow_cycles SET current_value = $1, status = $2, updated_at = NOW() WHERE id = $3;',
      [newScoreVal, nextStatus, cycleId]
    );

    return {
      success: true,
      measurementId: measurementRes.rows[0].id,
      cycleId,
      dayNumber,
      metricKey,
      baselineValue: baselineVal,
      currentValue: newScoreVal,
      delta: deltaVal,
      evaluationNotes,
      status: nextStatus
    };
  }

  /**
   * Registra un check-in diario de cumplimiento de rutina
   */
  async logCheckin(cycleId, userId, { amCompleted = true, pmCompleted = true, notes = '' }) {
    const parsedUserId = parseInt(userId, 10);
    const today = new Date().toISOString().split('T')[0];

    const checkinEntry = {
      date: today,
      amCompleted,
      pmCompleted,
      notes,
      timestamp: new Date().toISOString()
    };

    const updateQuery = `
      UPDATE glow_cycles
      SET checkin_history = checkin_history || $1::jsonb,
          updated_at = NOW()
      WHERE id = $2 AND user_id = $3
      RETURNING *;
    `;

    const res = await pool.query(updateQuery, [JSON.stringify([checkinEntry]), cycleId, parsedUserId]);
    return { success: true, loggedDate: today, checkin: checkinEntry };
  }

  /**
   * Evalúa semánticamente el delta de progreso
   */
  evaluateDelta(metricKey, delta, current, target) {
    const improved = delta > 0;
    const progressPercent = target !== current ? Math.min(100, Math.round((current / target) * 100)) : 100;

    if (improved) {
      return `Progreso positivo detectado: ${metricKey} aumentó en +${delta} puntos (Alcance actual: ${progressPercent}% hacia el objetivo de ${target}). Continúa con tu rutina.`;
    } else if (delta === 0) {
      return `Estabilidad dérmica: ${metricKey} se mantiene en ${current}. Sugerimos reforzar el paso de hidratación nocturna.`;
    } else {
      return `Variación detectada: ${metricKey} presenta una leve disminución (${delta} puntos). El agente Atena ajustará los activos en tu próximo ciclo.`;
    }
  }

  /**
   * Ejecuta un Re-escaneo completo, calcula el Delta, aplica adherencia y adapta el plan
   */
  async performRescan({
    cycleId,
    userId,
    dayNumber = 15,
    faceScores,
    handsDiagnosis
  }) {
    const parsedUserId = parseInt(userId, 10);
    logger.info('Iniciando Re-scan en Glow Cycle', { cycleId, userId: parsedUserId, dayNumber });

    // 1. Obtener ciclo
    const cycleRes = await pool.query('SELECT * FROM glow_cycles WHERE id = $1 AND user_id = $2;', [cycleId, parsedUserId]);
    if (cycleRes.rows.length === 0) {
      throw new Error('Glow Cycle no encontrado.');
    }

    const cycle = cycleRes.rows[0];
    const metricKey = cycle.target_metric_key || 'hydration';
    const baselineVal = parseFloat(cycle.baseline_value || 50);
    const newScoreVal = faceScores && faceScores[metricKey] !== undefined ? parseFloat(faceScores[metricKey]) : baselineVal;
    const targetVal = parseFloat(cycle.target_value || 75);

    // 2. Calcular Delta
    const deltaVal = parseFloat((newScoreVal - baselineVal).toFixed(2));

    // 3. Evaluar adherencia
    const checkins = Array.isArray(cycle.checkin_history) ? cycle.checkin_history : [];
    const adherencePercent = dayNumber > 0 ? Math.min(100, Math.round((checkins.length / dayNumber) * 100)) : 100;

    // 4. Adaptar Plan con TransformationEngine
    const adaptationResult = transformationEngine.adaptPlanBasedOnDelta({
      currentPlan: {
        amRoutine: cycle.am_routine,
        pmRoutine: cycle.pm_routine
      },
      delta: deltaVal,
      metricKey,
      currentValue: newScoreVal,
      targetValue: targetVal
    });

    // 5. Guardar medición cifrada
    const encryptedScores = biometricCryptoService.encrypt({ faceScores, handsDiagnosis });
    const scoreDelta = {
      [metricKey]: deltaVal,
      previous_baseline: baselineVal,
      current: newScoreVal,
      adherence_rate: `${adherencePercent}%`
    };

    const measurementType = dayNumber >= cycle.duration_days ? 'final_30d' : `milestone_${dayNumber}d`;
    const insertMeasurementQuery = `
      INSERT INTO glow_cycle_measurements (
        cycle_id, user_id, measurement_type, day_number, encrypted_scores, score_delta, ai_evaluation_notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `;

    const measRes = await pool.query(insertMeasurementQuery, [
      cycleId,
      parsedUserId,
      measurementType,
      parseInt(dayNumber, 10),
      encryptedScores,
      JSON.stringify(scoreDelta),
      adaptationResult.adaptationReason
    ]);

    // 6. Actualizar ciclo con nuevos valores y rutina adaptada
    const nextStatus = adaptationResult.isGoalReached || dayNumber >= cycle.duration_days ? 'completed' : 'active';
    const updateCycleQuery = `
      UPDATE glow_cycles
      SET current_value = $1,
          status = $2,
          am_routine = $3,
          pm_routine = $4,
          updated_at = NOW()
      WHERE id = $5
      RETURNING *;
    `;

    const updatedCycleRes = await pool.query(updateCycleQuery, [
      newScoreVal,
      nextStatus,
      JSON.stringify(adaptationResult.amRoutine),
      JSON.stringify(adaptationResult.pmRoutine),
      cycleId
    ]);

    const updatedCycle = updatedCycleRes.rows[0];
    await this._cacheActiveCycle(parsedUserId, updatedCycle);

    return {
      success: true,
      cycleId,
      dayNumber,
      measurementId: measRes.rows[0].id,
      metricKey,
      baselineValue: baselineVal,
      currentValue: newScoreVal,
      targetValue: targetVal,
      delta: deltaVal,
      adherenceRate: `${adherencePercent}%`,
      adaptationType: adaptationResult.adaptationType,
      adaptationReason: adaptationResult.adaptationReason,
      status: nextStatus,
      amRoutine: adaptationResult.amRoutine,
      pmRoutine: adaptationResult.pmRoutine
    };
  }

  /**
   * Gradúa y cierra formalmente un ciclo permitiendo iniciar el siguiente
   */
  async graduateCycle(cycleId, userId, { nextGoal = null, nextMetricKey = 'pores' } = {}) {
    const parsedUserId = parseInt(userId, 10);
    const res = await pool.query(
      "UPDATE glow_cycles SET status = 'completed', updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING *;",
      [cycleId, parsedUserId]
    );

    if (res.rows.length === 0) throw new Error('Ciclo no encontrado.');

    // Invalidar caché
    if (redisClient && redisClient.isOpen) {
      await redisClient.del(`glow:active_cycle:${parsedUserId}`);
    }

    return {
      success: true,
      graduatedCycleId: cycleId,
      status: 'completed',
      message: 'Ciclo graduado con éxito. Listo para comenzar el siguiente Glow Cycle.'
    };
  }

  async _cacheActiveCycle(userId, cycle) {
    try {
      if (redisClient && redisClient.isOpen) {
        await redisClient.setEx(`glow:active_cycle:${userId}`, CYCLE_CACHE_TTL, JSON.stringify(cycle));
      }
    } catch (e) {
      // Non-blocking cache error
    }
  }
}

module.exports = new GlowCycleService();

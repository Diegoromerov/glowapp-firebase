// backend/src/tests/glowCycle.service.test.js
const glowCycleService = require('../services/glowCycleService');
const { pool } = require('../config/db');
const redisClient = require('../config/redis');

// Mocking dependencies
jest.mock('../config/db', () => ({
  pool: {
    query: jest.fn()
  }
}));

jest.mock('../config/redis', () => ({
  isOpen: true,
  get: jest.fn(),
  setEx: jest.fn(),
  del: jest.fn()
}));

jest.mock('../services/biometricCryptoService', () => ({
  encrypt: jest.fn(() => 'encrypted_mock_string'),
  decrypt: jest.fn(() => ({ hydration: 65, pores: 30 }))
}));

const mockGeneratePlan = jest.fn().mockResolvedValue({
  planSummary: 'Plan de prueba',
  amRoutine: [{ step: 1, action: 'Limpieza' }],
  pmRoutine: [{ step: 1, action: 'Crema' }],
  recommendedProducts: [],
  recommendedServices: []
});

const mockAdaptPlan = jest.fn().mockReturnValue({
  adaptationType: 'maintain',
  adaptationReason: 'Progreso positivo sostenido (+15.00 puntos). Mantener la rutina.',
  amRoutine: [{ step: 1, action: 'Limpieza' }],
  pmRoutine: [{ step: 1, action: 'Crema' }],
  isGoalReached: false
});

jest.mock('../services/transformationEngine', () => ({
  generateTransformationPlan: (...args) => mockGeneratePlan(...args),
  adaptPlanBasedOnDelta: (...args) => mockAdaptPlan(...args)
}));

describe('Glow Cycle Engine - Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGeneratePlan.mockResolvedValue({
      planSummary: 'Plan de prueba',
      amRoutine: [{ step: 1, action: 'Limpieza' }],
      pmRoutine: [{ step: 1, action: 'Crema' }],
      recommendedProducts: [],
      recommendedServices: []
    });
    mockAdaptPlan.mockReturnValue({
      adaptationType: 'maintain',
      adaptationReason: 'Progreso positivo sostenido (+15.00 puntos). Mantener la rutina.',
      amRoutine: [{ step: 1, action: 'Limpieza' }],
      pmRoutine: [{ step: 1, action: 'Crema' }],
      isGoalReached: false
    });
  });

  test('createCycle should create active cycle and record baseline measurement', async () => {
    const mockCycle = {
      id: 'cycle-uuid-123',
      user_id: 1,
      cycle_type: 'skin',
      status: 'active',
      target_goal: 'Mejorar hydration de 55 a 75 en 30 días',
      target_metric_key: 'hydration',
      baseline_value: '55.00',
      target_value: '75.00',
      current_value: '55.00',
      duration_days: 30,
      start_date: new Date(),
      end_date: new Date()
    };

    pool.query
      .mockResolvedValueOnce({ rows: [mockCycle] }) // insert cycle
      .mockResolvedValueOnce({ rows: [{ id: 'meas-uuid-1' }] }); // insert measurement

    const result = await glowCycleService.createCycle({
      userId: 1,
      cycleType: 'skin',
      faceScores: { hydration: 55, pores: 40 },
      targetMetricKey: 'hydration',
      targetValue: 75,
      durationDays: 30
    });

    expect(result.success).toBe(true);
    expect(result.cycleId).toBe('cycle-uuid-123');
    expect(result.baselineValue).toBe(55);
    expect(result.targetValue).toBe(75);
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  test('recordMeasurement should calculate delta correctly and update status', async () => {
    const mockCycle = {
      id: 'cycle-uuid-123',
      user_id: 1,
      target_metric_key: 'hydration',
      baseline_value: '55.00',
      target_value: '75.00',
      duration_days: 30
    };

    pool.query
      .mockResolvedValueOnce({ rows: [mockCycle] }) // select cycle
      .mockResolvedValueOnce({ rows: [{ id: 'meas-uuid-2' }] }) // insert measurement
      .mockResolvedValueOnce({ rows: [] }); // update cycle

    const result = await glowCycleService.recordMeasurement({
      cycleId: 'cycle-uuid-123',
      userId: 1,
      measurementType: 'milestone_15d',
      dayNumber: 15,
      faceScores: { hydration: 68 }
    });

    expect(result.success).toBe(true);
    expect(result.delta).toBe(13); // 68 - 55 = +13
    expect(result.currentValue).toBe(68);
    expect(result.status).toBe('active');
    expect(result.evaluationNotes).toContain('Progreso positivo detectado');
  });

  test('evaluateDelta should handle improvement, stability and decrease correctly', () => {
    const positive = glowCycleService.evaluateDelta('hydration', 10, 65, 75);
    expect(positive).toContain('Progreso positivo');

    const stable = glowCycleService.evaluateDelta('hydration', 0, 55, 75);
    expect(stable).toContain('Estabilidad dérmica');

    const decrease = glowCycleService.evaluateDelta('hydration', -5, 50, 75);
    expect(decrease).toContain('Variación detectada');
  });

  test('performRescan should calculate delta with adherence, adapt routine and update cycle', async () => {
    const mockCycle = {
      id: 'cycle-uuid-123',
      user_id: 1,
      target_metric_key: 'hydration',
      baseline_value: '50.00',
      target_value: '75.00',
      duration_days: 30,
      checkin_history: [{ date: '2026-09-01' }, { date: '2026-09-02' }],
      am_routine: [],
      pm_routine: []
    };

    pool.query
      .mockResolvedValueOnce({ rows: [mockCycle] }) // select cycle
      .mockResolvedValueOnce({ rows: [{ id: 'meas-uuid-rescan' }] }) // insert measurement
      .mockResolvedValueOnce({ rows: [{ ...mockCycle, current_value: 65.00 }] }); // update cycle

    const res = await glowCycleService.performRescan({
      cycleId: 'cycle-uuid-123',
      userId: 1,
      dayNumber: 15,
      faceScores: { hydration: 65 }
    });

    expect(res.success).toBe(true);
    expect(res.delta).toBe(15); // 65 - 50 = +15
    expect(res.currentValue).toBe(65);
    expect(res.adaptationType).toBe('maintain');
  });

  test('graduateCycle should close active cycle successfully', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'cycle-uuid-123', status: 'completed' }] });

    const res = await glowCycleService.graduateCycle('cycle-uuid-123', 1);
    expect(res.success).toBe(true);
    expect(res.status).toBe('completed');
  });

  test('getActiveCycle should attach Chronos continuity evaluation and measurements', async () => {
    const mockCycle = {
      id: 'cycle-uuid-123',
      user_id: 1,
      status: 'active',
      duration_days: 30,
      start_date: new Date().toISOString(),
      checkin_history: []
    };

    pool.query
      .mockResolvedValueOnce({ rows: [mockCycle] }) // select active cycle
      .mockResolvedValueOnce({ rows: [{ id: 'meas-1', day_number: 1 }] }); // select measurements

    const res = await glowCycleService.getActiveCycle(1);
    expect(res).not.toBeNull();
    expect(res.continuity).toBeDefined();
    expect(res.continuity.hasActiveContinuity).toBe(true);
    expect(res.continuity.currentDayNumber).toBe(1);
    expect(res.measurements.length).toBe(1);
  });
});

// backend/src/tests/transformationEngine.test.js
const transformationEngine = require('../services/transformationEngine');
const hestiaAgent = require('../services/agents/hestiaAgent');
const hermesAgent = require('../services/agents/hermesAgent');

jest.mock('../services/agents/hestiaAgent', () => ({
  recommendProducts: jest.fn()
}));

jest.mock('../services/agents/hermesAgent', () => ({
  findNearbyServices: jest.fn()
}));

describe('Adaptive Transformation Engine - Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Caso A: Diagnóstico -> Objetivo -> Plan estructurado AM/PM', async () => {
    hestiaAgent.recommendProducts.mockResolvedValueOnce({ products: [] });

    const plan = await transformationEngine.generateTransformationPlan({
      userId: 1,
      cycleType: 'skin',
      faceScores: { hydration: 48, pores: 55, wrinkles: 20 },
      targetMetricKey: 'hydration'
    });

    expect(plan.success).toBe(true);
    expect(plan.targetMetricKey).toBe('hydration');
    expect(plan.targetIngredients).toContain('Ácido Hialurónico');
    expect(plan.amRoutine.length).toBeGreaterThanOrEqual(3);
    expect(plan.pmRoutine.length).toBeGreaterThanOrEqual(2);
    expect(plan.amRoutine[0]).toHaveProperty('time');
    expect(plan.amRoutine[0]).toHaveProperty('reason');
  });

  test('Caso B/C: Intervención con productos contextuales opcionales de GlowStore', async () => {
    hestiaAgent.recommendProducts.mockResolvedValueOnce({
      products: [
        { id: 'prod-001', nombre: 'Sérum Ácido Hialurónico', precio: 65000, categoria: 'Piel' }
      ]
    });

    const plan = await transformationEngine.generateTransformationPlan({
      userId: 1,
      cycleType: 'skin',
      faceScores: { hydration: 40 },
      targetMetricKey: 'hydration'
    });

    expect(plan.recommendedProducts.length).toBe(1);
    expect(plan.recommendedProducts[0].name).toBe('Sérum Ácido Hialurónico');
    expect(plan.recommendedProducts[0].reason).toContain('Formulado con activos compatibles');
  });

  test('Caso D/E: Intervención con servicios profesionales de Marketplace si hay severidad y ubicación', async () => {
    hestiaAgent.recommendProducts.mockResolvedValueOnce({ products: [] });
    hermesAgent.findNearbyServices.mockResolvedValueOnce({
      services: [
        { service_id: 'srv-001', name: 'Limpieza Facial Profunda', provider_id: 10, business_name: 'Spa Luxe', price: 90000, distance_km: 2.5 }
      ]
    });

    const plan = await transformationEngine.generateTransformationPlan({
      userId: 1,
      cycleType: 'skin',
      faceScores: { hydration: 50, pores: 60 },
      targetMetricKey: 'pores',
      userLocation: { latitude: 4.6097, longitude: -74.0817 }
    });

    expect(plan.recommendedServices.length).toBe(1);
    expect(plan.recommendedServices[0].name).toBe('Limpieza Facial Profunda');
    expect(plan.recommendedServices[0].providerId).toBe(10);
  });

  test('Caso H/I/J/K: Adaptación del plan según Delta (Maintain, Intensify, Modify, Completed)', () => {
    const basePlan = {
      amRoutine: [{ step: 1, action: 'Exfoliante suave' }],
      pmRoutine: [{ step: 1, action: 'Crema hidratante' }]
    };

    // Maintain (Progreso positivo)
    const resMaintain = transformationEngine.adaptPlanBasedOnDelta({
      currentPlan: basePlan,
      delta: 12,
      metricKey: 'hydration',
      currentValue: 67,
      targetValue: 75
    });
    expect(resMaintain.adaptationType).toBe('maintain');

    // Intensify (Meseta / Sin cambio)
    const resIntensify = transformationEngine.adaptPlanBasedOnDelta({
      currentPlan: basePlan,
      delta: 0,
      metricKey: 'hydration',
      currentValue: 55,
      targetValue: 75
    });
    expect(resIntensify.adaptationType).toBe('intensify');
    expect(resIntensify.pmRoutine.length).toBe(2);

    // Modify (Variación negativa)
    const resModify = transformationEngine.adaptPlanBasedOnDelta({
      currentPlan: basePlan,
      delta: -6,
      metricKey: 'hydration',
      currentValue: 49,
      targetValue: 75
    });
    expect(resModify.adaptationType).toBe('modify');
    expect(resModify.amRoutine[0].action).toContain('Limpiador Ultra-Suave');

    // Completed (Meta alcanzada)
    const resCompleted = transformationEngine.adaptPlanBasedOnDelta({
      currentPlan: basePlan,
      delta: 20,
      metricKey: 'hydration',
      currentValue: 78,
      targetValue: 75
    });
    expect(resCompleted.adaptationType).toBe('completed');
    expect(resCompleted.isGoalReached).toBe(true);
  });

  test('Caso Multidominio: Soporte explícito de rutinas para Hands y Color', async () => {
    hestiaAgent.recommendProducts.mockResolvedValue({ products: [] });

    // Hands
    const handsPlan = await transformationEngine.generateTransformationPlan({
      userId: 1,
      cycleType: 'hands',
      handsDiagnosis: { hydration: 40 },
      targetMetricKey: 'hydration'
    });
    expect(handsPlan.cycleType).toBe('hands');
    expect(handsPlan.amRoutine[0].action).toContain('Bálsamo de Manos con Urea');
    expect(handsPlan.pmRoutine[0].action).toContain('cutículas');

    // Color
    const colorPlan = await transformationEngine.generateTransformationPlan({
      userId: 1,
      cycleType: 'color',
      targetMetricKey: 'harmony'
    });
    expect(colorPlan.cycleType).toBe('color');
    expect(colorPlan.amRoutine[1].action).toContain('armonía personalizada');
  });
});

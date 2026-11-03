const { buildProjections } = require('../services/adminMetricsService');

describe('ORDEN A-02 — Pure Financial Projections Service (Honestidad de métricas financieras)', () => {

  test('C1\': buildProjections con historial vacío (0 meses) devuelve status insuficiente y projectedRevenue null', () => {
    const fixedNow = new Date('2026-09-25T12:00:00Z');
    const result = buildProjections([], fixedNow);

    expect(result.data_status).toBe('insuficiente');
    expect(result.meses_con_datos).toBe(0);
    expect(result.history).toEqual([]);
    expect(result.projectedRevenue).toBeNull();
    expect(result.projectedMonth).toBeNull();
    expect(result.trend).toBe('INSUFICIENTE');
  });

  test('C2\': buildProjections con 1 o 2 meses reales devuelve status insuficiente, sin inventar ingresos proyectados y conservando historial real', () => {
    const fixedNow = new Date('2026-09-25T12:00:00Z');
    const oneMonth = [{ month: '2026-07', revenue: 1500 }];
    const result1 = buildProjections(oneMonth, fixedNow);

    expect(result1.data_status).toBe('insuficiente');
    expect(result1.meses_con_datos).toBe(1);
    expect(result1.history).toEqual(oneMonth);
    expect(result1.projectedRevenue).toBeNull();

    const twoMonths = [
      { month: '2026-07', revenue: 1500 },
      { month: '2026-08', revenue: 2000 }
    ];
    const result2 = buildProjections(twoMonths, fixedNow);

    expect(result2.data_status).toBe('insuficiente');
    expect(result2.meses_con_datos).toBe(2);
    expect(result2.history).toEqual(twoMonths);
    expect(result2.projectedRevenue).toBeNull();
  });

  test('C3\': buildProjections con ≥3 meses reales devuelve data_status completo y cálculo por regresión lineal verificado independientemente', () => {
    const fixedNow = new Date('2026-09-25T12:00:00Z');
    const threeMonths = [
      { month: '2026-06', revenue: 1000 },
      { month: '2026-07', revenue: 2000 },
      { month: '2026-08', revenue: 3000 }
    ];
    const result = buildProjections(threeMonths, fixedNow);

    expect(result.data_status).toBe('completo');
    expect(result.meses_con_datos).toBe(3);
    expect(result.history).toEqual(threeMonths);
    expect(result.projectedMonth).toBe('2026-10');
    expect(result.trend).toBe('CRECIENTE');

    // Independent calculation: (1,1000), (2,2000), (3,3000) => line: y = 1000 * x.
    // For x = 4 (next month): expected = 4000.
    const xVals = [1, 2, 3];
    const yVals = [1000, 2000, 3000];
    const n = 3;
    const sumX = xVals.reduce((a, b) => a + b, 0);
    const sumY = yVals.reduce((a, b) => a + b, 0);
    const sumXY = xVals.reduce((sum, x, i) => sum + x * yVals[i], 0);
    const sumXX = xVals.reduce((sum, x) => sum + x * x, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    const expectedProjection = Math.max(0, Math.round(slope * 4 + intercept));

    expect(result.projectedRevenue).toBe(expectedProjection);
    expect(result.projectedRevenue).toBe(4000);
  });

  test('C4\': Comportamiento puro probado sin acoplamiento a red/BD. (Manejo de HTTP 503 por BD degradada es responsabilidad global de degradedLockMiddleware)', () => {
    // buildProjections es una función pura determinista
    const res = buildProjections(null, new Date('2026-09-25'));
    expect(res.data_status).toBe('insuficiente');
    expect(res.projectedRevenue).toBeNull();
  });

});

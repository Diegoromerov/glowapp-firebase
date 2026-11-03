/**
 * backend/src/tests/qualityGates.test.js
 * Tests unitarios para qualityGates.js
 * Mínimo 6 casos
 */

const { 
  QUALITY_GATES, 
  checkQualityGates, 
  generateQualityGatesReport 
} = require('../config/qualityGates');

describe('qualityGates', () => {
  describe('QUALITY_GATES constants', () => {
    test('debe tener thresholds de retrieval definidos', () => {
      expect(QUALITY_GATES.retrieval.precision_at_5).toBe(0.70);
      expect(QUALITY_GATES.retrieval.recall_at_5).toBe(0.60);
      expect(QUALITY_GATES.retrieval.mrr).toBe(0.65);
      expect(QUALITY_GATES.retrieval.context_precision).toBe(0.70);
    });

    test('debe tener thresholds de generation definidos', () => {
      expect(QUALITY_GATES.generation.faithfulness).toBe(0.80);
      expect(QUALITY_GATES.generation.answer_relevancy).toBe(0.75);
    });

    test('debe tener thresholds de latency definidos', () => {
      expect(QUALITY_GATES.latency.p50_ms).toBe(3000);
      expect(QUALITY_GATES.latency.p95_ms).toBe(8000);
      expect(QUALITY_GATES.latency.p99_ms).toBe(15000);
    });

    test('debe tener thresholds de availability definidos', () => {
      expect(QUALITY_GATES.availability.error_rate).toBe(0.05);
      expect(QUALITY_GATES.availability.fallback_rate).toBe(0.20);
    });
  });

  describe('checkQualityGates', () => {
    test('debe pasar cuando todas las métricas cumplen thresholds', () => {
      const metrics = {
        summary: {
          retrieval: { 
            precision_at_k: 0.80, 
            recall_at_k: 0.70,
            mrr: 0.75
          },
          generation: { 
            faithfulness: 0.90, 
            answer_relevancy: 0.85 
          },
          context: { 
            precision: 0.80 
          },
          latency: { 
            p50_ms: 2000, 
            p95_ms: 5000, 
            p99_ms: 10000 
          },
          availability: { 
            error_rate: 0.01, 
            fallback_rate: 0.10 
          }
        }
      };
      
      const result = checkQualityGates(metrics);
      
      expect(result.passed).toBe(true);
      expect(result.failures).toHaveLength(0);
      expect(result.summary.failed).toBe(0);
    });

    test('debe fallar cuando precision_at_5 está por debajo del threshold', () => {
      const metrics = {
        summary: {
          retrieval: { 
            precision_at_k: 0.60, // < 0.70
            recall_at_k: 0.70,
            mrr: 0.75
          },
          generation: { 
            faithfulness: 0.90, 
            answer_relevancy: 0.85 
          },
          context: { 
            precision: 0.80 
          },
          latency: { 
            p50_ms: 2000, 
            p95_ms: 5000, 
            p99_ms: 10000 
          },
          availability: { 
            error_rate: 0.01, 
            fallback_rate: 0.10 
          }
        }
      };
      
      const result = checkQualityGates(metrics);
      
      expect(result.passed).toBe(false);
      expect(result.failures.length).toBeGreaterThan(0);
      expect(result.failures.some(f => f.gate === 'retrieval.precision_at_5')).toBe(true);
    });

    test('debe fallar cuando faithfulness está por debajo del threshold', () => {
      const metrics = {
        summary: {
          retrieval: { 
            precision_at_k: 0.80, 
            recall_at_k: 0.70,
            mrr: 0.75
          },
          generation: { 
            faithfulness: 0.70, // < 0.80
            answer_relevancy: 0.85 
          },
          context: { 
            precision: 0.80 
          },
          latency: { 
            p50_ms: 2000, 
            p95_ms: 5000, 
            p99_ms: 10000 
          },
          availability: { 
            error_rate: 0.01, 
            fallback_rate: 0.10 
          }
        }
      };
      
      const result = checkQualityGates(metrics);
      
      expect(result.passed).toBe(false);
      expect(result.failures.some(f => f.gate === 'generation.faithfulness')).toBe(true);
    });

    test('debe generar warnings para latency p50/p55 por encima del threshold', () => {
      const metrics = {
        summary: {
          retrieval: { 
            precision_at_k: 0.80, 
            recall_at_k: 0.70,
            mrr: 0.75
          },
          generation: { 
            faithfulness: 0.90, 
            answer_relevancy: 0.85 
          },
          context: { 
            precision: 0.80 
          },
          latency: { 
            p50_ms: 4000, // > 3000
            p95_ms: 10000, // > 8000
            p99_ms: 10000 
          },
          availability: { 
            error_rate: 0.01, 
            fallback_rate: 0.10 
          }
        }
      };
      
      const result = checkQualityGates(metrics);
      
      // p50 y p95 son warnings, p99 pasa
      expect(result.warnings.some(w => w.gate === 'latency.p50_ms')).toBe(true);
      expect(result.warnings.some(w => w.gate === 'latency.p95_ms')).toBe(true);
      expect(result.passed).toBe(true); // warnings no fallan
    });

    test('debe fallar cuando latency p99 está por encima del threshold', () => {
      const metrics = {
        summary: {
          retrieval: { 
            precision_at_k: 0.80, 
            recall_at_k: 0.70,
            mrr: 0.75
          },
          generation: { 
            faithfulness: 0.90, 
            answer_relevancy: 0.85 
          },
          context: { 
            precision: 0.80 
          },
          latency: { 
            p50_ms: 2000, 
            p95_ms: 5000, 
            p99_ms: 20000 // > 15000
          },
          availability: { 
            error_rate: 0.01, 
            fallback_rate: 0.10 
          }
        }
      };
      
      const result = checkQualityGates(metrics);
      
      expect(result.passed).toBe(false);
      expect(result.failures.some(f => f.gate === 'latency.p99_ms')).toBe(true);
    });

    test('debe manejar métricas faltantes sin error', () => {
      const metrics = {
        summary: {
          retrieval: { 
            precision_at_k: 0.80 
            // faltan recall, mrr
          },
          generation: { 
            faithfulness: 0.90 
            // falta answer_relevancy
          }
          // faltan context, latency, availability
        }
      };
      
      const result = checkQualityGates(metrics);
      
      // Solo verifica lo que existe
      expect(result.passed).toBe(true);
    });
  });

  describe('generateQualityGatesReport', () => {
    test('debe generar reporte con formato correcto para passed', () => {
      const checkResult = {
        passed: true,
        failures: [],
        warnings: [],
        summary: { total_gates_checked: 10, failed: 0, warned: 0, critical_failures: 0 }
      };
      
      const report = generateQualityGatesReport(checkResult);
      
      expect(report).toContain('✅ TODOS LOS QUALITY GATES PASARON');
      expect(report).toContain('QUALITY GATES REPORT');
    });

    test('debe generar reporte con errores y warnings', () => {
      const checkResult = {
        passed: false,
        failures: [
          { metric: 'Precision@5', actual: 0.60, expected: 0.70, message: 'Precision@5 (0.60) por debajo del umbral (0.70)' }
        ],
        warnings: [
          { metric: 'Latency P50', actual: 4000, expected: 3000, message: 'Latencia P50 (4000ms) por encima del umbral (3000ms)' }
        ],
        summary: { total_gates_checked: 10, failed: 1, warned: 1, critical_failures: 1 }
      };
      
      const report = generateQualityGatesReport(checkResult);
      
      expect(report).toContain('❌ 1 GATE(S) FALLARON');
      expect(report).toContain('🚨 ERRORES CRÍTICOS');
      expect(report).toContain('Precision@5');
      expect(report).toContain('⚠️  ADVERTENCIAS');
      expect(report).toContain('Latency P50');
    });
  });
});
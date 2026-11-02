/**
 * backend/src/tests/ragMetrics.test.js
 * Tests unitarios para ragMetrics.js
 * Mínimo 4 casos
 */

// Mock pool first - must be before require
const mockPool = { query: jest.fn() };

jest.mock('../config/db', () => ({
  pool: mockPool
}));

const { 
  getProductionMetrics, 
  getMetricsByDay, 
  getMetricsWithComparison,
  detectAnomalies 
} = require('../services/ragMetrics');

describe('ragMetrics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getProductionMetrics', () => {
    test('debe retornar métricas agregadas para 24h', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            total_queries: '100',
            error_count: '2',
            deepseek_count: '60',
            gemini_count: '30',
            fallback_count: '10',
            avg_chunks_retrieved: '3.5',
            avg_top_score: '0.85',
            p50_latency_ms: '2500',
            p95_latency_ms: '6000',
            p99_latency_ms: '12000',
            avg_embedding_latency_ms: '150',
            avg_retrieval_latency_ms: '800',
            avg_llm_latency_ms: '1500',
            tool_calls_count: '25',
            avg_tools_per_query: '0.25'
          }]
        })
        .mockResolvedValueOnce({
          rows: [{ max_chunks: '5' }]
        });
      
      const metrics = await getProductionMetrics('24h');
      
      expect(metrics.time_range).toBe('24h');
      expect(metrics.overview.total_queries).toBe(100);
      expect(metrics.overview.error_rate).toBe(0.02);
      expect(metrics.overview.fallback_rate).toBe(0.10);
      expect(metrics.llm_distribution.deepseek).toBe(60);
      expect(metrics.llm_distribution.gemini).toBe(30);
      expect(metrics.llm_distribution.fallback).toBe(10);
      expect(metrics.retrieval.avg_chunks_retrieved).toBe(3.5);
      expect(metrics.retrieval.avg_top_score).toBe(0.85);
      expect(metrics.latency.p50_ms).toBe(2500);
      expect(metrics.latency.p95_ms).toBe(6000);
      expect(metrics.latency.p99_ms).toBe(12000);
    });

    test('debe manejar resultado vacío', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{}] })
        .mockResolvedValueOnce({ rows: [{ max_chunks: null }] });
      
      const metrics = await getProductionMetrics('24h');
      
      expect(metrics.overview.total_queries).toBe(0);
      expect(metrics.overview.error_rate).toBe(0);
    });
  });

  describe('getMetricsByDay', () => {
    test('debe retornar serie temporal diaria', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            date: '2026-08-01',
            total_queries: '50',
            error_count: '1',
            deepseek_count: '30',
            gemini_count: '15',
            fallback_count: '5',
            avg_chunks_retrieved: '3.2',
            avg_top_score: '0.82',
            p50_latency_ms: '2400',
            p95_latency_ms: '5800',
            avg_embedding_latency_ms: '140',
            avg_retrieval_latency_ms: '750',
            avg_llm_latency_ms: '1400'
          },
          {
            date: '2026-08-02',
            total_queries: '60',
            error_count: '0',
            deepseek_count: '35',
            gemini_count: '20',
            fallback_count: '5',
            avg_chunks_retrieved: '3.8',
            avg_top_score: '0.88',
            p50_latency_ms: '2600',
            p95_latency_ms: '6200',
            avg_embedding_latency_ms: '160',
            avg_retrieval_latency_ms: '850',
            avg_llm_latency_ms: '1550'
          }
        ]
      });
      
      const metrics = await getMetricsByDay(30);
      
      expect(metrics).toHaveLength(2);
      expect(metrics[0].date).toBe('2026-08-01');
      expect(metrics[0].total_queries).toBe(50);
      expect(metrics[0].error_rate).toBe(0.02);
      expect(metrics[1].date).toBe('2026-08-02');
      expect(metrics[1].total_queries).toBe(60);
    });
  });

  describe('detectAnomalies', () => {
    test('debe detectar aumento crítico en error_rate', () => {
      const current = {
        overview: { error_rate: 0.15 },
        latency: { p50_ms: 2500, p95_ms: 6000 },
        retrieval: { avg_top_score: 0.85, avg_chunks_retrieved: 3.5 }
      };
      
      const previous = {
        overview: { error_rate: 0.02 },
        latency: { p50_ms: 2400, p95_ms: 5800 },
        retrieval: { avg_top_score: 0.86, avg_chunks_retrieved: 3.6 }
      };
      
      const anomalies = detectAnomalies(current, previous);
      
      expect(anomalies.length).toBeGreaterThan(0);
      const errorAnomaly = anomalies.find(a => a.metric === 'error_rate');
      expect(errorAnomaly).toBeDefined();
      expect(errorAnomaly.severity).toBe('critical');
      expect(errorAnomaly.direction).toBe('increase');
    });

    test('debe detectar aumento en fallback_rate', () => {
      const current = {
        overview: { error_rate: 0.02, fallback_rate: 0.35 },
        latency: { p50_ms: 2500, p95_ms: 6000 },
        retrieval: { avg_top_score: 0.85, avg_chunks_retrieved: 3.5 }
      };
      
      const previous = {
        overview: { error_rate: 0.02, fallback_rate: 0.10 },
        latency: { p50_ms: 2400, p95_ms: 5800 },
        retrieval: { avg_top_score: 0.86, avg_chunks_retrieved: 3.6 }
      };
      
      const anomalies = detectAnomalies(current, previous);
      
      const fallbackAnomaly = anomalies.find(a => a.metric === 'fallback_rate');
      expect(fallbackAnomaly).toBeDefined();
      expect(fallbackAnomaly.severity).toBe('critical');
    });

    test('debe detectar degradación en latencia p95', () => {
      const current = {
        overview: { error_rate: 0.02, fallback_rate: 0.10 },
        latency: { p50_ms: 2500, p95_ms: 10000 },
        retrieval: { avg_top_score: 0.85, avg_chunks_retrieved: 3.5 }
      };
      
      const previous = {
        overview: { error_rate: 0.02, fallback_rate: 0.10 },
        latency: { p50_ms: 2400, p95_ms: 5800 },
        retrieval: { avg_top_score: 0.86, avg_chunks_retrieved: 3.6 }
      };
      
      const anomalies = detectAnomalies(current, previous);
      
      const latencyAnomaly = anomalies.find(a => a.metric === 'p95_latency_ms');
      expect(latencyAnomaly).toBeDefined();
      expect(latencyAnomaly.direction).toBe('increase');
    });

    test('no debe detectar anomalías si métricas son estables', () => {
      const current = {
        overview: { error_rate: 0.02, fallback_rate: 0.10 },
        latency: { p50_ms: 2500, p95_ms: 6000 },
        retrieval: { avg_top_score: 0.85, avg_chunks_retrieved: 3.5 }
      };
      
      const previous = {
        overview: { error_rate: 0.02, fallback_rate: 0.10 },
        latency: { p50_ms: 2400, p95_ms: 5800 },
        retrieval: { avg_top_score: 0.86, avg_chunks_retrieved: 3.6 }
      };
      
      const anomalies = detectAnomalies(current, previous);
      
      expect(anomalies).toHaveLength(0);
    });

    test('debe manejar previousMetrics nulo', () => {
      const current = { overview: { error_rate: 0.15 } };
      const anomalies = detectAnomalies(current, null);
      expect(anomalies).toHaveLength(0);
    });
  });
});
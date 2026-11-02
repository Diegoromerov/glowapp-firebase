const { wrapRouterAsync } = require('../utils/expressAsync');
// backend/src/routes/metricsRoutes.js
const express = require('express');
const router = express.Router();
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { 
  getProductionMetrics, 
  getMetricsByDay, 
  getMetricsWithComparison,
  detectAnomalies 
} = require('../services/ragMetrics');
const { checkQualityGates } = require('../config/qualityGates');

// Middleware: autenticación + admin
router.use(authMiddleware);
router.use(adminMiddleware);

/**
 * GET /api/metrics/rag
 * Retorna métricas de producción del RAG
 * Query params: timeRange (24h, 7d, 30d, 90d), compare (true/false)
 */
router.get('/rag', async (req, res) => {
  try {
    const timeRange = req.query.timeRange || '24h';
    const compare = req.query.compare === 'true';
    
    let metrics;
    if (compare) {
      metrics = await getMetricsWithComparison(timeRange);
    } else {
      metrics = await getProductionMetrics(timeRange);
    }
    
    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    console.error('❌ Error GET /api/metrics/rag:', error.message);
    res.status(500).json({ 
      error: 'internal_error', 
      message: 'Error obteniendo métricas RAG' 
    });
  }
});

/**
 * GET /api/metrics/rag/daily
 * Retorna serie temporal diaria para dashboard
 * Query params: days (default 30)
 */
router.get('/rag/daily', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const metrics = await getMetricsByDay(days);
    
    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    console.error('❌ Error GET /api/metrics/rag/daily:', error.message);
    res.status(500).json({ 
      error: 'internal_error', 
      message: 'Error obteniendo métricas diarias RAG' 
    });
  }
});

/**
 * GET /api/metrics/rag/health
 * Health check rápido de calidad RAG
 */
router.get('/rag/health', async (req, res) => {
  try {
    const metrics = await getProductionMetrics('24h');
    const gateResult = checkQualityGates({ summary: metrics });
    
    res.json({
      success: true,
      data: {
        healthy: gateResult.passed,
        time_range: '24h',
        total_queries: metrics.overview.total_queries,
        error_rate: metrics.overview.error_rate,
        fallback_rate: metrics.overview.fallback_rate,
        p95_latency_ms: metrics.latency.p95_ms,
        avg_top_score: metrics.retrieval.avg_top_score,
        gates: {
          passed: gateResult.passed,
          failures: gateResult.failures.length,
          warnings: gateResult.warnings.length
        }
      }
    });
  } catch (error) {
    console.error('❌ Error GET /api/metrics/rag/health:', error.message);
    res.status(500).json({ 
      error: 'internal_error', 
      message: 'Error health check RAG' 
    });
  }
});

/**
 * GET /api/metrics/rag/dashboard
 * Dashboard completo para admin - todas las métricas en una llamada
 * Query params: timeRange (24h, 7d, 30d, 90d), days (para serie temporal)
 */
router.get('/rag/dashboard', async (req, res) => {
  try {
    const timeRange = req.query.timeRange || '24h';
    const days = parseInt(req.query.days) || 30;
    const compare = req.query.compare === 'true';
    
    // Ejecutar todas las consultas en paralelo para performance
    const [
      currentMetrics,
      dailyMetrics,
      comparisonMetrics,
      anomalies,
      qualityGates
    ] = await Promise.all([
      getProductionMetrics(timeRange),
      getMetricsByDay(days),
      compare ? getMetricsWithComparison(timeRange) : Promise.resolve(null),
      detectAnomalies(timeRange),
      checkQualityGates({ summary: await getProductionMetrics(timeRange) })
    ]);
    
    // Calcular resumen ejecutivo
    const overview = currentMetrics.overview || {};
    const retrieval = currentMetrics.retrieval || {};
    const generation = currentMetrics.generation || {};
    const latency = currentMetrics.latency || {};
    const availability = currentMetrics.availability || {};
    
    // Quality gates con detalle
    const qualityGatesDetail = {
      passed: qualityGates.passed,
      summary: qualityGates.passed ? 'All gates passed' : `${qualityGates.failures.length} failures, ${qualityGates.warnings.length} warnings`,
      gates: {
        retrieval: {
          precision_at_5: { value: retrieval.precision_at_5 || 0, threshold: 0.70, passed: (retrieval.precision_at_5 || 0) >= 0.70 },
          recall_at_5: { value: retrieval.recall_at_5 || 0, threshold: 0.60, passed: (retrieval.recall_at_5 || 0) >= 0.60 },
          mrr: { value: retrieval.mrr || 0, threshold: 0.65, passed: (retrieval.mrr || 0) >= 0.65 },
          context_precision: { value: retrieval.context_precision || 0, threshold: 0.70, passed: (retrieval.context_precision || 0) >= 0.70 },
        },
        generation: {
          faithfulness: { value: generation.faithfulness || 0, threshold: 0.80, passed: (generation.faithfulness || 0) >= 0.80 },
          answer_relevancy: { value: generation.answer_relevancy || 0, threshold: 0.75, passed: (generation.answer_relevancy || 0) >= 0.75 },
        },
        latency: {
          p50_ms: { value: latency.p50_ms || 0, threshold: 3000, passed: (latency.p50_ms || 0) <= 3000 },
          p95_ms: { value: latency.p95_ms || 0, threshold: 8000, passed: (latency.p95_ms || 0) <= 8000 },
          p99_ms: { value: latency.p99_ms || 0, threshold: 15000, passed: (latency.p99_ms || 0) <= 15000 },
        },
        availability: {
          error_rate: { value: availability.error_rate || 0, threshold: 0.05, passed: (availability.error_rate || 0) <= 0.05 },
          fallback_rate: { value: availability.fallback_rate || 0, threshold: 0.20, passed: (availability.fallback_rate || 0) <= 0.20 },
        },
      }
    }
    
    // Resumen ejecutivo
    const executiveSummary = {
      total_queries: overview.total_queries || 0,
      queries_per_hour: overview.total_queries ? (overview.total_queries / (timeRange === '24h' ? 24 : timeRange === '7d' ? 168 : 720)).toFixed(1) : 0,
      avg_latency_ms: latency.p50_ms || 0,
      p95_latency_ms: latency.p95_ms || 0,
      error_rate: (overview.error_rate * 100).toFixed(2) + '%',
      fallback_rate: (overview.fallback_rate * 100).toFixed(2) + '%',
      cache_hit_rate: overview.cache_hit_rate ? (overview.cache_hit_rate * 100).toFixed(1) + '%' : 'N/A',
      quality_score: qualityGates.passed ? 'PASS' : 'FAIL',
      health_status: qualityGates.passed ? 'healthy' : 'degraded',
    }
    
    // Formato para gráficos
    const timeSeriesData = dailyMetrics.map(d => ({
      date: d.date,
      queries: d.total_queries,
      avg_latency_ms: d.avg_latency_ms,
      error_rate: d.error_rate,
      fallback_rate: d.fallback_rate,
      avg_top_score: d.avg_top_score,
      chunks_per_query: d.avg_chunks_per_query,
    }))
    
    // LLM Usage Distribution
    const llmUsage = currentMetrics.llm_usage || {}
    const totalLlmCalls = Object.values(llmUsage).reduce((a, b) => a + b, 0)
    const llmDistribution = {}
    for (const [llm, count] of Object.entries(llmUsage)) {
      llmDistribution[llm] = totalLlmCalls > 0 ? ((count / totalLlmCalls) * 100).toFixed(1) + '%' : '0%'
    }
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      time_range: timeRange,
      days_analyzed: days,
      executive_summary: executiveSummary,
      quality_gates: qualityGatesDetail,
      time_series: timeSeriesData,
      llm_distribution: llmDistribution,
      anomalies: anomalies.anomalies || [],
      comparison: comparisonMetrics ? {
        retrieval_change: comparisonMetrics.retrieval ? {
          precision_at_5: ((comparisonMetrics.retrieval.precision_at_5 - (currentMetrics.retrieval?.precision_at_5 || 0)) * 100).toFixed(1) + '%',
          recall_at_5: ((comparisonMetrics.retrieval.recall_at_5 - (currentMetrics.retrieval?.recall_at_5 || 0)) * 100).toFixed(1) + '%',
        } : null,
        generation_change: comparisonMetrics.generation ? {
          faithfulness: ((comparisonMetrics.generation.faithfulness - (currentMetrics.generation?.faithfulness || 0)) * 100).toFixed(1) + '%',
          answer_relevancy: ((comparisonMetrics.generation.answer_relevancy - (currentMetrics.generation?.answer_relevancy || 0)) * 100).toFixed(1) + '%',
        } : null,
        latency_change: comparisonMetrics.latency ? {
          p50_ms: comparisonMetrics.latency.p50_ms - (currentMetrics.latency?.p50_ms || 0),
          p95_ms: comparisonMetrics.latency.p95_ms - (currentMetrics.latency?.p95_ms || 0),
        } : null,
      } : null,
    })
  } catch (error) {
    console.error('❌ Error GET /api/metrics/rag/dashboard:', error.message)
    res.status(500).json({ 
      error: 'internal_error', 
      message: 'Error obteniendo dashboard RAG',
      details: error.message
    })
  }
})

/**
 * GET /api/metrics/rag/export
 * Exporta métricas en formato CSV para análisis externo
 */
router.get('/rag/export', async (req, res) => {
  try {
    const timeRange = req.query.timeRange || '7d'
    const metrics = await getProductionMetrics(timeRange)
    const dailyMetrics = await getMetricsByDay(30)
    
    // Generar CSV
    const csvHeaders = 'date,total_queries,avg_latency_ms,error_rate,fallback_rate,avg_top_score,chunks_per_query\n'
    const csvRows = dailyMetrics.map(d => 
      `${d.date},${d.total_queries},${d.avg_latency_ms},${d.error_rate.toFixed(4)},${d.fallback_rate.toFixed(4)},${d.avg_top_score.toFixed(4)},${d.avg_chunks_per_query.toFixed(2)}`
    ).join('\n')
    
    const csv = csvHeaders + csvRows
    
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="rag_metrics_${timeRange}_${new Date().toISOString().split('T')[0]}.csv"`)
    res.send(csv)
  } catch (error) {
    console.error('❌ Error GET /api/metrics/rag/export:', error.message)
    res.status(500).json({ 
      error: 'internal_error', 
      message: 'Error exportando métricas' 
    })
  }
})

wrapRouterAsync(router);
module.exports = router
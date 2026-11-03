/**
 * backend/src/services/ragMetrics.js
 * Servicio de métricas de producción para RAG
 * Lee de rag_query_logs y genera métricas agregadas para dashboard
 */

const { pool } = require('../config/db');

/**
 * Obtiene métricas agregadas de producción para un rango de tiempo
 * @param {string} timeRange - '24h', '7d', '30d', '90d' o ISO date range
 * @returns {Promise<Object>} Métricas agregadas
 */
async function getProductionMetrics(timeRange = '24h') {
  let interval;
  switch (timeRange) {
    case '24h': interval = "INTERVAL '24 hours'"; break;
    case '7d': interval = "INTERVAL '7 days'"; break;
    case '30d': interval = "INTERVAL '30 days'"; break;
    case '90d': interval = "INTERVAL '90 days'"; break;
    default: interval = "INTERVAL '24 hours'";
  }
  
  const query = `
    SELECT 
      COUNT(*) as total_queries,
      COUNT(*) FILTER (WHERE error IS NOT NULL) as error_count,
      COUNT(*) FILTER (WHERE llm_used = 'deepseek') as deepseek_count,
      COUNT(*) FILTER (WHERE llm_used = 'gemini') as gemini_count,
      COUNT(*) FILTER (WHERE llm_used = 'safe_fallback') as fallback_count,
      AVG(chunks_retrieved) as avg_chunks_retrieved,
      AVG(top_score) as avg_top_score,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY total_latency_ms) as p50_latency_ms,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_latency_ms) as p95_latency_ms,
      PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY total_latency_ms) as p99_latency_ms,
      AVG(query_embedding_latency_ms) as avg_embedding_latency_ms,
      AVG(retrieval_latency_ms) as avg_retrieval_latency_ms,
      AVG(llm_latency_ms) as avg_llm_latency_ms,
      COUNT(*) FILTER (WHERE tool_calls IS NOT NULL AND jsonb_array_length(tool_calls) > 0) as tool_calls_count,
      AVG(jsonb_array_length(tool_calls)) as avg_tools_per_query
    FROM rag_query_logs
    WHERE created_at > NOW() - ${interval}
  `;
  
  const result = await pool.query(query);
  const row = result.rows[0];
  
  const total = parseInt(row.total_queries) || 0;
  const errorCount = parseInt(row.error_count) || 0;
  const fallbackCount = parseInt(row.fallback_count) || 0;
  const toolCallsCount = parseInt(row.tool_calls_count) || 0;
  
  return {
    time_range: timeRange,
    period_start: new Date(Date.now() - parseInterval(timeRange)).toISOString(),
    period_end: new Date().toISOString(),
    overview: {
      total_queries: total,
      error_rate: total > 0 ? Math.round((errorCount / total) * 10000) / 10000 : 0,
      fallback_rate: total > 0 ? Math.round((fallbackCount / total) * 10000) / 10000 : 0,
      tool_usage_rate: total > 0 ? Math.round((toolCallsCount / total) * 10000) / 10000 : 0
    },
    llm_distribution: {
      deepseek: parseInt(row.deepseek_count) || 0,
      gemini: parseInt(row.gemini_count) || 0,
      fallback: fallbackCount,
      deepseek_pct: total > 0 ? Math.round(((parseInt(row.deepseek_count) || 0) / total) * 10000) / 10000 : 0,
      gemini_pct: total > 0 ? Math.round(((parseInt(row.gemini_count) || 0) / total) * 10000) / 10000 : 0,
      fallback_pct: total > 0 ? Math.round((fallbackCount / total) * 10000) / 10000 : 0
    },
    retrieval: {
      avg_chunks_retrieved: row.avg_chunks_retrieved ? Math.round(parseFloat(row.avg_chunks_retrieved) * 100) / 100 : 0,
      avg_top_score: row.avg_top_score ? Math.round(parseFloat(row.avg_top_score) * 10000) / 10000 : 0,
      max_chunks_retrieved: await getMaxChunks(timeRange)
    },
    latency: {
      p50_ms: row.p50_latency_ms ? Math.round(parseFloat(row.p50_latency_ms)) : 0,
      p95_ms: row.p95_latency_ms ? Math.round(parseFloat(row.p95_latency_ms)) : 0,
      p99_ms: row.p99_latency_ms ? Math.round(parseFloat(row.p99_latency_ms)) : 0,
      avg_total_ms: row.avg_embedding_latency_ms ? Math.round(
        parseFloat(row.avg_embedding_latency_ms) + 
        parseFloat(row.avg_retrieval_latency_ms) + 
        parseFloat(row.avg_llm_latency_ms)
      ) : 0,
      breakdown: {
        embedding_ms: row.avg_embedding_latency_ms ? Math.round(parseFloat(row.avg_embedding_latency_ms)) : 0,
        retrieval_ms: row.avg_retrieval_latency_ms ? Math.round(parseFloat(row.avg_retrieval_latency_ms)) : 0,
        llm_ms: row.avg_llm_latency_ms ? Math.round(parseFloat(row.avg_llm_latency_ms)) : 0
      }
    },
    tools: {
      total_tool_calls: toolCallsCount,
      avg_tools_per_query: row.avg_tools_per_query ? Math.round(parseFloat(row.avg_tools_per_query) * 100) / 100 : 0
    }
  };
}

/**
 * Obtiene serie temporal de métricas por día
 * @param {number} days - Número de días hacia atrás
 * @returns {Promise<Array>} Serie temporal diaria
 */
async function getMetricsByDay(days = 30) {
  const query = `
    SELECT 
      DATE(created_at) as date,
      COUNT(*) as total_queries,
      COUNT(*) FILTER (WHERE error IS NOT NULL) as error_count,
      COUNT(*) FILTER (WHERE llm_used = 'deepseek') as deepseek_count,
      COUNT(*) FILTER (WHERE llm_used = 'gemini') as gemini_count,
      COUNT(*) FILTER (WHERE llm_used = 'safe_fallback') as fallback_count,
      AVG(chunks_retrieved) as avg_chunks_retrieved,
      AVG(top_score) as avg_top_score,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY total_latency_ms) as p50_latency_ms,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_latency_ms) as p95_latency_ms,
      AVG(query_embedding_latency_ms) as avg_embedding_latency_ms,
      AVG(retrieval_latency_ms) as avg_retrieval_latency_ms,
      AVG(llm_latency_ms) as avg_llm_latency_ms
    FROM rag_query_logs
    WHERE created_at > NOW() - INTERVAL '${days} days'
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `;
  
  const result = await pool.query(query);
  
  return result.rows.map(row => ({
    date: row.date,
    total_queries: parseInt(row.total_queries) || 0,
    error_rate: row.total_queries > 0 ? Math.round((parseInt(row.error_count) / parseInt(row.total_queries)) * 10000) / 10000 : 0,
    fallback_rate: row.total_queries > 0 ? Math.round((parseInt(row.fallback_count) / parseInt(row.total_queries)) * 10000) / 10000 : 0,
    llm_distribution: {
      deepseek: parseInt(row.deepseek_count) || 0,
      gemini: parseInt(row.gemini_count) || 0,
      fallback: parseInt(row.fallback_count) || 0
    },
    retrieval: {
      avg_chunks_retrieved: row.avg_chunks_retrieved ? Math.round(parseFloat(row.avg_chunks_retrieved) * 100) / 100 : 0,
      avg_top_score: row.avg_top_score ? Math.round(parseFloat(row.avg_top_score) * 10000) / 10000 : 0
    },
    latency: {
      p50_ms: row.p50_latency_ms ? Math.round(parseFloat(row.p50_latency_ms)) : 0,
      p95_ms: row.p95_latency_ms ? Math.round(parseFloat(row.p95_latency_ms)) : 0,
      avg_embedding_ms: row.avg_embedding_latency_ms ? Math.round(parseFloat(row.avg_embedding_latency_ms)) : 0,
      avg_retrieval_ms: row.avg_retrieval_latency_ms ? Math.round(parseFloat(row.avg_retrieval_latency_ms)) : 0,
      avg_llm_ms: row.avg_llm_latency_ms ? Math.round(parseFloat(row.avg_llm_latency_ms)) : 0
    }
  }));
}

/**
 * Detecta anomalías en métricas comparando con período anterior
 * @param {Object} currentMetrics - Métricas actuales
 * @param {Object} previousMetrics - Métricas período anterior
 * @returns {Array} Lista de anomalías detectadas
 */
function detectAnomalies(currentMetrics, previousMetrics) {
  const anomalies = [];
  
  if (!previousMetrics) return anomalies;
  
  // Helper para comparar
  const checkChange = (current, previous, metric, threshold = 0.3) => {
    if (previous === 0 || previous === undefined) return null;
    const change = (current - previous) / previous;
    if (Math.abs(change) > threshold) {
      return {
        metric,
        current,
        previous,
        change_pct: Math.round(change * 10000) / 100,
        severity: Math.abs(change) > 0.5 ? 'critical' : 'warning',
        direction: change > 0 ? 'increase' : 'decrease'
      };
    }
    return null;
  };
  
  // Comparar métricas clave
  const comparisons = [
    { current: currentMetrics.overview?.error_rate, previous: previousMetrics.overview?.error_rate, metric: 'error_rate', threshold: 0.5 },
    { current: currentMetrics.overview?.fallback_rate, previous: previousMetrics.overview?.fallback_rate, metric: 'fallback_rate', threshold: 0.3 },
    { current: currentMetrics.latency?.p50_ms, previous: previousMetrics.latency?.p50_ms, metric: 'p50_latency_ms', threshold: 0.3 },
    { current: currentMetrics.latency?.p95_ms, previous: previousMetrics.latency?.p95_ms, metric: 'p95_latency_ms', threshold: 0.3 },
    { current: currentMetrics.retrieval?.avg_top_score, previous: previousMetrics.retrieval?.avg_top_score, metric: 'avg_top_score', threshold: 0.2 },
    { current: currentMetrics.retrieval?.avg_chunks_retrieved, previous: previousMetrics.retrieval?.avg_chunks_retrieved, metric: 'avg_chunks_retrieved', threshold: 0.3 }
  ];
  
  for (const c of comparisons) {
    const anomaly = checkChange(c.current, c.previous, c.metric, c.threshold);
    if (anomaly) anomalies.push(anomaly);
  }
  
  return anomalies;
}

/**
 * Obtiene métricas comparando período actual con anterior
 * @param {string} timeRange - Rango de tiempo actual
 * @returns {Promise<Object>} Métricas con comparación y anomalías
 */
async function getMetricsWithComparison(timeRange = '24h') {
  const current = await getProductionMetrics(timeRange);
  
  // Calcular período anterior equivalente
  const previousRange = getPreviousRange(timeRange);
  const previous = await getProductionMetrics(previousRange);
  
  const anomalies = detectAnomalies(current, previous);
  
  return {
    current,
    previous: {
      time_range: previousRange,
      ...previous
    },
    anomalies,
    comparison: {
      error_rate_change: calculateChange(current.overview?.error_rate, previous.overview?.error_rate),
      fallback_rate_change: calculateChange(current.overview?.fallback_rate, previous.overview?.fallback_rate),
      latency_p50_change: calculateChange(current.latency?.p50_ms, previous.latency?.p50_ms),
      latency_p95_change: calculateChange(current.latency?.p95_ms, previous.latency?.p95_ms),
      top_score_change: calculateChange(current.retrieval?.avg_top_score, previous.retrieval?.avg_top_score)
    }
  };
}

// Funciones auxiliares
function parseInterval(timeRange) {
  switch (timeRange) {
    case '24h': return 24 * 60 * 60 * 1000;
    case '7d': return 7 * 24 * 60 * 60 * 1000;
    case '30d': return 30 * 24 * 60 * 60 * 1000;
    case '90d': return 90 * 24 * 60 * 60 * 1000;
    default: return 24 * 60 * 60 * 1000;
  }
}

function getPreviousRange(timeRange) {
  switch (timeRange) {
    case '24h': return '24h'; // Comparar con 24h anteriores
    case '7d': return '7d';
    case '30d': return '30d';
    default: return '24h';
  }
}

function calculateChange(current, previous) {
  if (!previous || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}

async function getMaxChunks(timeRange) {
  let interval;
  switch (timeRange) {
    case '24h': interval = "INTERVAL '24 hours'"; break;
    case '7d': interval = "INTERVAL '7 days'"; break;
    case '30d': interval = "INTERVAL '30 days'"; break;
    default: interval = "INTERVAL '24 hours'";
  }
  
  const query = `SELECT MAX(chunks_retrieved) as max_chunks FROM rag_query_logs WHERE created_at > NOW() - ${interval}`;
  const result = await pool.query(query);
  return parseInt(result.rows[0]?.max_chunks) || 0;
}

module.exports = {
  getProductionMetrics,
  getMetricsByDay,
  getMetricsWithComparison,
  detectAnomalies
};
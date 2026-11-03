/**
 * backend/src/services/ragLogger.js
 * Logger estructurado para trazabilidad RAG
 * Registra cada consulta con métricas completas para evaluación y debug
 */

const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { sanitizeForLog, hashIdForLog } = require('../utils/piiSanitizer');
const { breakers } = require('./circuitBreakerService');

/**
 * Directorio de logs
 */
const LOGS_DIR = path.join(__dirname, '../../logs');
const RAG_LOG_FILE = path.join(LOGS_DIR, 'rag_traces.log');

/**
 * Asegurar directorio de logs existe
 */
function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

/**
 * Genera trace_id único
 * @returns {string} UUID v4
 */
function generateTraceId() {
  return uuidv4();
}

/**
 * Sanitiza query para logs (usa piiSanitizer existente)
 * @param {string} query - Query original
 * @returns {string} Query sanitizada
 */
function sanitizeQuery(query) {
  return sanitizeForLog(query);
}

/**
 * Obtiene estado de circuit breakers
 * @returns {Object} Estado de breakers
 */
function getBreakerStates() {
  const states = {};
  if (breakers) {
    for (const [name, breaker] of Object.entries(breakers)) {
      states[name] = {
        state: breaker.state,
        failureCount: breaker.failureCount,
        nextAttempt: breaker.nextAttempt ? new Date(breaker.nextAttempt).toISOString() : null,
      };
    }
  }
  return states;
}

/**
 * Sanitiza chunks para logs (sin contenido completo, solo metadata)
 * @param {Array} chunks - Chunks recuperados
 * @returns {Array} Top 3 chunks con metadata mínima
 */
function sanitizeChunksForLog(chunks) {
  if (!chunks || !Array.isArray(chunks)) return [];
  
  return chunks.slice(0, 3).map(chunk => ({
    chunk_id: chunk.chunk_id || chunk.id || hashIdForLog(chunk.id),
    similarity_score: typeof chunk.similarity === 'number' ? parseFloat(chunk.similarity.toFixed(4)) : null,
    category: chunk.category || null,
    skin_type: chunk.skinType || chunk.skin_type || null,
    has_content: !!chunk.content,
  }));
}

/**
 * Formatea tool calls para logs
 * @param {Array} toolCalls - Tool calls ejecutados
 * @returns {Array} Tool calls formateados
 */
function formatToolCallsForLog(toolCalls) {
  if (!toolCalls || !Array.isArray(toolCalls)) return [];
  
  return toolCalls.map(tc => ({
    name: tc.name || tc.function_name,
    args_sanitized: sanitizeQuery(JSON.stringify(tc.args || tc.arguments || {})),
    latency_ms: tc.latency_ms || null,
    success: tc.success !== false,
  }));
}

/**
 * Escribe log a archivo (producción) o console (desarrollo)
 * @param {Object} traceData - Datos del trace
 */
function writeLog(traceData) {
  const isProduction = process.env.NODE_ENV === 'production';
  const logLine = JSON.stringify(traceData);
  
  if (isProduction) {
    try {
      ensureLogsDir();
      fs.appendFileSync(RAG_LOG_FILE, logLine + '\n');
    } catch (error) {
      console.error('❌ Error escribiendo rag log:', error.message);
      // Fallback a console
      console.log(logLine);
    }
  } else {
    // En desarrollo: pretty print a console
    console.log('📊 [RAG_TRACE]', logLine);
  }
}

/**
 * Intenta guardar en PostgreSQL (opcional, no bloqueante)
 * @param {Object} traceData - Datos del trace
 * @returns {Promise<void>}
 */
async function saveToPostgres(traceData) {
  try {
    const { pool } = require('../config/db');
    if (!pool) return;
    
    const query = `
      INSERT INTO rag_query_logs
      (trace_id, user_id_hash, query_sanitized, chunks_retrieved, top_score, llm_used,
       total_latency_ms, error, category, threshold_used, filters_applied, all_scores,
       retrieval_mode, fallback_triggered, breaker_state_at_query, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
      ON CONFLICT DO NOTHING
    `;

    await pool.query(query, [
      traceData.trace_id,
      traceData.user_id_hash,
      traceData.query,
      traceData.chunks_retrieved,
      traceData.top_score,
      traceData.llm_used,
      traceData.total_latency_ms,
      traceData.error || null,
      traceData.category || null,
      // El umbral REALMENTE usado por el retrieval (antes se registraba un valor fijo
      // distinto del que usaba la búsqueda: 0.72 en el log, 0.45 en la consulta).
      typeof traceData.threshold_used === 'number' ? traceData.threshold_used : null,
      traceData.filters_applied ? JSON.stringify(traceData.filters_applied) : null,
      Array.isArray(traceData.all_scores) && traceData.all_scores.length > 0 ? traceData.all_scores : null,
      traceData.retrieval_mode || null,
      typeof traceData.fallback_triggered === 'boolean' ? traceData.fallback_triggered : null,
      traceData.breaker_state_at_query || null,
    ]);
  } catch (error) {
    // Silencioso - no bloquear si falla
    if (error.code !== '42P01') { // Ignorar "table does not exist"
      console.warn('⚠️ No se pudo guardar en rag_query_logs:', error.message);
    }
  }
}

/**
 * Función principal: registra una consulta RAG completa
 * @param {Object} traceData - Datos de la consulta
 * @param {string} traceData.trace_id - UUID único (se genera si no se proporciona)
 * @param {string|number} traceData.user_id - ID del usuario (se hashea)
 * @param {string} traceData.query - Query original del usuario
 * @param {number} traceData.query_embedding_latency_ms - Latencia embedding query
 * @param {number} traceData.retrieval_latency_ms - Latencia búsqueda pgVector
 * @param {Array} traceData.chunks - Chunks recuperados (se sanitizan)
 * @param {Object} traceData.filters - Filtros aplicados
 * @param {string} traceData.llm_used - 'deepseek' | 'gemini' | 'safe_fallback'
 * @param {number} traceData.llm_latency_ms - Latencia LLM
 * @param {Array} traceData.tool_calls - Tools invocadas
 * @param {number} traceData.total_latency_ms - Latencia total
 * @param {string} traceData.error - Error si lo hubo
 * @returns {Promise<void>}
 */
async function logRagQuery(traceData) {
  const startTime = Date.now();
  
  try {
    // Generar trace_id si no existe
    const trace_id = traceData.trace_id || generateTraceId();
    
    // Hashear user_id
    const user_id_hash = hashIdForLog(traceData.user_id);
    
    // Sanitizar query
    const query_sanitized = sanitizeQuery(traceData.query);
    
    // Sanitizar chunks
    const top_chunks = sanitizeChunksForLog(traceData.chunks);
    const chunks_retrieved = traceData.chunks ? traceData.chunks.length : 0;
    const top_score = top_chunks.length > 0 ? top_chunks[0].similarity_score : null;
    
    // Formatear tool calls
    const tool_calls = formatToolCallsForLog(traceData.tool_calls);
    
    // Estado de breakers
    const circuit_breaker_state = getBreakerStates();
    
    // Construir objeto de log completo
    const logEntry = {
      trace_id,
      timestamp: new Date().toISOString(),
      user_id_hash,
      query: query_sanitized,
      query_embedding_latency_ms: traceData.query_embedding_latency_ms || 0,
      retrieval_latency_ms: traceData.retrieval_latency_ms || 0,
      chunks_retrieved,
      top_chunks,
      top_score,
      category: traceData.category || top_chunks[0]?.category || null,
      // Umbral y modo reales del retrieval (los aporta ragService vía `trace`).
      threshold_used: typeof traceData.threshold_used === 'number' ? traceData.threshold_used : null,
      filters_applied: traceData.filters_applied || traceData.filters || {},
      filters_dropped: traceData.filters_dropped || [],
      filters_relaxed: traceData.filters_relaxed === true,
      all_scores: Array.isArray(traceData.all_scores) ? traceData.all_scores : [],
      retrieval_mode: traceData.retrieval_mode || null,
      fallback_triggered: traceData.fallback_triggered === true,
      breaker_state_at_query: getBreakerStates()?.nvidiaEmbeddings?.state || null,
      llm_used: traceData.llm_used || 'unknown',
      llm_latency_ms: traceData.llm_latency_ms || 0,
      tool_calls,
      circuit_breaker_state,
      total_latency_ms: traceData.total_latency_ms || 0,
      error: traceData.error || null,
    };
    
    // Escribir log (archivo o console)
    writeLog(logEntry);
    
    // Guardar en PostgreSQL (async, no bloqueante)
    saveToPostgres(logEntry).catch(() => {});
    
  } catch (error) {
    console.error('❌ Error en logRagQuery:', error.message);
    // No lanzar error - logging nunca debe romper el flujo
  }
}

/**
 * Obtiene métricas agregadas para dashboard
 * @param {Object} options - { startDate, endDate, user_id_hash }
 * @returns {Promise<Object>} Métricas agregadas
 */
async function getRagMetrics(options = {}) {
  try {
    const { pool } = require('../config/db');
    if (!pool) return null;
    
    let whereClause = 'WHERE 1=1';
    const params = [];
    let paramIndex = 1;
    
    if (options.startDate) {
      whereClause += ` AND created_at >= $${paramIndex++}`;
      params.push(options.startDate);
    }
    if (options.endDate) {
      whereClause += ` AND created_at <= $${paramIndex++}`;
      params.push(options.endDate);
    }
    if (options.user_id_hash) {
      whereClause += ` AND user_id_hash = $${paramIndex++}`;
      params.push(options.user_id_hash);
    }
    
    const query = `
      SELECT 
        COUNT(*) as total_queries,
        AVG(total_latency_ms) as avg_latency_ms,
        AVG(retrieval_latency_ms) as avg_retrieval_latency_ms,
        AVG(llm_latency_ms) as avg_llm_latency_ms,
        AVG(chunks_retrieved) as avg_chunks_retrieved,
        AVG(top_score) as avg_top_score,
        COUNT(CASE WHEN error IS NOT NULL THEN 1 END) as error_count,
        COUNT(CASE WHEN llm_used = 'gemini' THEN 1 END) as gemini_fallbacks,
        COUNT(CASE WHEN llm_used = 'safe_fallback' THEN 1 END) as safe_fallbacks
      FROM rag_query_logs
      ${whereClause}
    `;
    
    const result = await pool.query(query, params);
    return result.rows[0];
  } catch (error) {
    console.warn('⚠️ No se pudieron obtener métricas RAG:', error.message);
    return null;
  }
}

/**
 * Obtiene estadísticas de breakers para logs
 * @returns {Object}
 */
function getCircuitBreakerStats() {
  return getBreakerStates();
}

module.exports = {
  logRagQuery,
  generateTraceId,
  getRagMetrics,
  getCircuitBreakerStats,
  sanitizeQuery,
  sanitizeChunksForLog,
  formatToolCallsForLog,
};
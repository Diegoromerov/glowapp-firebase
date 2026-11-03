/**
 * backend/src/services/ragObservability.js
 * Shadow observability instrumentation for RAG pipeline
 * Implements R7-C2 instrumentation design (event schema v1.0)
 * Controlled by OBSERVABILITY_ENABLED feature flag
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { RAG_SIMILARITY_THRESHOLD } = require('../config/ragConfig');
const { sanitizeForLog, hashIdForLog } = require('../utils/piiSanitizer');
const { breakers } = require('./circuitBreakerService');

/**
 * Feature flag for observability
 * When OFF: zero instrumentation overhead, RAG behaves exactly as baseline
 * When ON: collects structured observability events
 */
const OBSERVABILITY_ENABLED = process.env.OBSERVABILITY_ENABLED === 'true';

/**
 * Sampling configuration per R7-C2 adaptive strategy
 * 100% for: fallback_triggered OR error OR top1_score < 0.5
 * 10% for: normal traffic
 */
const SAMPLING_RATE_NORMAL = 0.1;
const SAMPLING_RATE_CRITICAL = 1.0;

/**
 * Observability event schema version
 */
const EVENT_VERSION = '1.0';

/**
 * Directory for raw observability events (JSONL, daily rotation)
 */
const OBSERVABILITY_LOGS_DIR = path.join(__dirname, '../../logs/observability');

/**
 * Ensure observability logs directory exists
 */
function ensureObservabilityLogsDir() {
  if (!fs.existsSync(OBSERVABILITY_LOGS_DIR)) {
    fs.mkdirSync(OBSERVABILITY_LOGS_DIR, { recursive: true });
  }
}

/**
 * Generate trace_id (UUID v4) - reuses existing mechanism
 */
function generateTraceId() {
  return crypto.randomUUID();
}

/**
 * Generate query_hash from sanitized query
 */
function generateQueryHash(query) {
  const sanitized = sanitizeForLog(query);
  return crypto.createHash('sha256').update(sanitized).digest('hex');
}

/**
 * Get circuit breaker states snapshot
 */
function getBreakerStatesSnapshot() {
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
 * Determine if event should be sampled per adaptive strategy
 */
function shouldSample(event) {
  // Always sample critical events
  if (event.event_type === 'error') return true;
  if (event.event_type === 'fallback_triggered') return true;
  if (event.retrieval?.fallback_triggered) return true;
  if (event.retrieval?.scores?.[0] !== undefined && event.retrieval.scores[0] < 0.5) return true;
  
  // Sample normal traffic at 10%
  return Math.random() < SAMPLING_RATE_NORMAL;
}

/**
 * Write observability event to JSONL file (append-only, daily rotation)
 * Fail-safe: never throws, swallows errors
 */
function writeObservabilityEvent(event) {
  if (!OBSERVABILITY_ENABLED) return;
  
  try {
    // Apply sampling
    if (!shouldSample(event)) return;
    
    ensureObservabilityLogsDir();
    
    const today = new Date().toISOString().split('T')[0];
    const logFile = path.join(OBSERVABILITY_LOGS_DIR, `rag_observability_${today}.jsonl`);
    
    const eventWithVersion = {
      event_version: EVENT_VERSION,
      ...event,
    };
    
    const line = JSON.stringify(eventWithVersion);
    fs.appendFileSync(logFile, line + '\n');
  } catch (error) {
    // Fail-safe: never propagate observability errors
    console.warn('⚠️ [OBSERVABILITY] Write failed (swallowed):', error.message);
  }
}

/**
 * Build base event fields common to all event types
 */
function buildBaseEvent(traceId, userId, query, eventType) {
  return {
    trace_id: traceId,
    timestamp: new Date().toISOString(),
    event_type: eventType,
    user_id_hash: hashIdForLog(userId),
    query_hash: generateQueryHash(query),
    query_length: query ? query.length : 0,
  };
}

/**
 * Event: query_received
 * Emitted at start of processAssistantMessage
 */
function emitQueryReceived(traceId, userId, query, triggerDecision) {
  const event = buildBaseEvent(traceId, userId, query, 'query_received');
  event.trigger_decision = {
    enabled: triggerDecision.enabled,
    matched_keywords: triggerDecision.matched_keywords || [],
    category_predicted: triggerDecision.category_predicted || null,
  };
  writeObservabilityEvent(event);
}

/**
 * Event: embedding_complete
 * Emitted after query embedding generation
 */
function emitEmbeddingComplete(traceId, userId, query, embeddingResult) {
  const event = buildBaseEvent(traceId, userId, query, 'embedding_complete');
  event.embedding = {
    latency_ms: embeddingResult.latency_ms,
    success: embeddingResult.success,
    dimension: embeddingResult.dimension || 1024,
    input_type: embeddingResult.input_type || 'query',
    error: embeddingResult.error || null,
  };
  writeObservabilityEvent(event);
}

/**
 * Event: retrieval_complete
 * Emitted after vector search (or FTS fallback)
 */
function emitRetrievalComplete(traceId, userId, query, retrievalResult) {
  const event = buildBaseEvent(traceId, userId, query, 'retrieval_complete');
  
  const scores = retrievalResult.chunks?.map(c => c.similarity) || [];
  const top1 = scores[0] || 0;
  const top2 = scores[1] || 0;
  const top5 = scores[4] || scores[scores.length - 1] || 0;
  
  event.retrieval = {
    mode: retrievalResult.mode || 'hnsw',
    latency_ms: retrievalResult.latency_ms,
    candidate_count: retrievalResult.candidate_count || null,
    top_k: retrievalResult.top_k || 5,
    threshold: retrievalResult.threshold || RAG_SIMILARITY_THRESHOLD,
    filters_applied: retrievalResult.filters_applied || {},
    scores,
    score_gap_1_2: top1 - top2,
    score_gap_1_5: top1 - top5,
    score_mean: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    score_median: scores.length > 0 ? scores[Math.floor(scores.length / 2)] : null,
    score_stddev: scores.length > 1 
      ? Math.sqrt(scores.reduce((sum, s) => sum + Math.pow(s - (scores.reduce((a, b) => a + b, 0) / scores.length), 2), 0) / (scores.length - 1))
      : null,
    category_distribution: retrievalResult.category_distribution || {},
    duplicate_ratio: retrievalResult.duplicate_ratio || 0,
    fallback_triggered: retrievalResult.fallback_triggered || false,
    fallback_reason: retrievalResult.fallback_reason || null,
    fallback_layer: retrievalResult.fallback_layer || null,
  };
  writeObservabilityEvent(event);
}

/**
 * Event: fallback_triggered
 * Emitted when any fallback layer activates (can also be part of retrieval_complete)
 */
function emitFallbackTriggered(traceId, userId, query, fallbackInfo) {
  const event = buildBaseEvent(traceId, userId, query, 'fallback_triggered');
  event.retrieval = {
    mode: fallbackInfo.mode,
    latency_ms: fallbackInfo.latency_ms,
    fallback_triggered: true,
    fallback_reason: fallbackInfo.reason,
    fallback_layer: fallbackInfo.layer,
  };
  writeObservabilityEvent(event);
}

/**
 * Event: context_built
 * Emitted after formatKnowledgeContext
 */
function emitContextBuilt(traceId, userId, query, contextResult) {
  const event = buildBaseEvent(traceId, userId, query, 'context_built');
  event.context = {
    chunk_count: contextResult.chunk_count,
    char_count: contextResult.char_count,
    token_count_est: contextResult.token_count_est,
    categories: contextResult.categories || [],
    provenance: contextResult.provenance || [],
  };
  writeObservabilityEvent(event);
}

/**
 * Event: generation_complete
 * Emitted after LLM generation (DeepSeek, Gemini, or safe_fallback)
 */
function emitGenerationComplete(traceId, userId, query, generationResult) {
  const event = buildBaseEvent(traceId, userId, query, 'generation_complete');
  event.generation = {
    model: generationResult.model,
    latency_ms: generationResult.latency_ms,
    tool_calls: generationResult.tool_calls || 0,
    cache_hit: generationResult.cache_hit || false,
    error: generationResult.error || null,
  };
  writeObservabilityEvent(event);
}

/**
 * Event: response_sent
 * Emitted after response delivered to user
 */
function emitResponseSent(traceId, userId, query, responseResult) {
  const event = buildBaseEvent(traceId, userId, query, 'response_sent');
  event.response = {
    char_count: responseResult.char_count,
    has_citations: responseResult.has_citations || false,
    fallback_activated: responseResult.fallback_activated || false,
  };
  writeObservabilityEvent(event);
}

/**
 * Event: error
 * Emitted on any critical error in the pipeline
 */
function emitError(traceId, userId, query, errorInfo) {
  const event = buildBaseEvent(traceId, userId, query, 'error');
  event.error = {
    message: errorInfo.message,
    stage: errorInfo.stage,
    stack: errorInfo.stack || null,
  };
  writeObservabilityEvent(event);
}

/**
 * Consolidated event emission (alternative to per-stage events)
 * Emits single event at end with all collected data
 * Simpler but loses per-stage timing granularity
 */
function emitConsolidatedEvent(traceId, userId, query, consolidatedData) {
  const event = buildBaseEvent(traceId, userId, query, 'consolidated');
  event.query_received = consolidatedData.query_received || null;
  event.embedding = consolidatedData.embedding || null;
  event.retrieval = consolidatedData.retrieval || null;
  event.context = consolidatedData.context || null;
  event.generation = consolidatedData.generation || null;
  event.response = consolidatedData.response || null;
  event.circuit_breakers = consolidatedData.circuit_breakers || getBreakerStatesSnapshot();
  writeObservabilityEvent(event);
}

/**
 * Get observability status for health checks
 */
function getObservabilityStatus() {
  return {
    enabled: OBSERVABILITY_ENABLED,
    event_version: EVENT_VERSION,
    logs_directory: OBSERVABILITY_LOGS_DIR,
    sampling: {
      normal_rate: SAMPLING_RATE_NORMAL,
      critical_rate: SAMPLING_RATE_CRITICAL,
    },
  };
}

module.exports = {
  OBSERVABILITY_ENABLED,
  EVENT_VERSION,
  generateTraceId,
  getBreakerStatesSnapshot,
  writeObservabilityEvent,
  emitQueryReceived,
  emitEmbeddingComplete,
  emitRetrievalComplete,
  emitFallbackTriggered,
  emitContextBuilt,
  emitGenerationComplete,
  emitResponseSent,
  emitError,
  emitConsolidatedEvent,
  getObservabilityStatus,
  // Internal for testing
  _shouldSample: shouldSample,
  _generateQueryHash: generateQueryHash,
  _buildBaseEvent: buildBaseEvent,
};
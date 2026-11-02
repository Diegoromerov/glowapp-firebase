#!/usr/bin/env python3
"""Build R7-C1 Observability Audit Report - READ-ONLY analysis."""
import json, os

BASE = r"C:\beauty-app\backend\src\data\eval"

audit = {
  "cycle": "R7-C1",
  "status": "READY_FOR_CALIBRATION",
  "directive": "R7 — PRODUCTION OBSERVABILITY & CONFIDENCE CALIBRATION — Audit phase only",
  "r6_baseline": {
    "mrr": 0.7222,
    "r5": 0.6156,
    "r10": 0.6545,
    "vector_miss": 13,
    "model": "nvidia/nv-embedqa-e5-v5",
    "chunks": 5663,
    "rag_tests": "69/69 PASS"
  },
  "architecture_audit": {
    "flow": "USER_QUERY -> QUERY_NORMALIZATION -> QUERY_EMBEDDING -> VECTOR_SEARCH -> TOP-K -> SCORE_DISTRIBUTION -> CONTEXT_BUILDING -> PROMPT/GENERATION -> RESPONSE -> FALLBACK/ABSTENTION",
    "stages": [
      {
        "stage": "QUERY_NORMALIZATION",
        "file": "backend/src/services/geminiService.js",
        "function": "shouldSearchBeautyKnowledge",
        "line": 172,
        "input": "userMessageText (string)",
        "output": "boolean (knowledgeSearchEnabled)",
        "description": "Keyword-based trigger: RAG_TRIGGER_KEYWORDS array (80+ terms) matched against lowercase query",
        "errors_possible": "None -- pure string matching",
        "latency_ms": "<1",
        "observable_now": "Console log: 'Chunks RAG recuperados: ...'",
        "missing": "No structured logging of trigger decision; no query length/type/category recorded"
      },
      {
        "stage": "QUERY_EMBEDDING",
        "file": "backend/src/services/embeddingService.js",
        "function": "generateEmbedding / generateNvidiaEmbedding",
        "line": "55-146",
        "input": "text (string, truncated to 8000 chars), inputType='query'",
        "output": "number[1024] embedding vector",
        "description": "NVIDIA NIM API call with circuit breaker, exponential backoff retry (3x), timeout 15s",
        "errors_possible": "API timeout, 429/5xx, network errors, dimension mismatch, all-zeros embedding",
        "latency_ms": "~200-800 (NVIDIA API)",
        "observable_now": "Console warn on retry; circuit breaker state via breakers.nvidiaEmbeddings",
        "missing": "No structured latency histogram; no embedding vector stored (PII-safe but no debug); no input_type logged"
      },
      {
        "stage": "VECTOR_SEARCH",
        "file": "backend/src/services/ragService.js",
        "function": "searchBeautyKnowledge",
        "line": "86-155",
        "input": "queryEmbedding (vector), options: {topK=5, threshold=0.45, filters}",
        "output": "Array of {id, title, content, category, similarity}",
        "description": "pgVector HNSW cosine search (<=>), with metadata filters (category, skin_type, contraindications, ingredients). FTS fallback on vector error.",
        "errors_possible": "DB connection, query timeout, vector dimension mismatch, FTS fallback also fails",
        "latency_ms": "~50-200 (pgVector), +FTS fallback if triggered",
        "observable_now": "Console log chunks titles; fallback warning if triggered; no structured metrics",
        "missing": "No score distribution (top-K scores, gaps, stddev); no candidate count before threshold; no filter effectiveness; no retrieval_mode flag (hnsw/fts/hybrid); no all_scores array"
      },
      {
        "stage": "SCORE_DISTRIBUTION",
        "file": "N/A -- not currently computed",
        "function": "--",
        "line": "--",
        "input": "retrieved chunks with similarity scores",
        "output": "--",
        "description": "Currently NOT computed. Could derive: top1, top5_mean, gap(top1-top2), gap(top1-top5), stddev, concentration",
        "errors_possible": "--",
        "latency_ms": "--",
        "observable_now": "Only top chunk similarity visible in console log",
        "missing": "ALL score distribution signals missing -- critical for confidence calibration"
      },
      {
        "stage": "CONTEXT_BUILDING",
        "file": "backend/src/services/ragService.js",
        "function": "formatKnowledgeContext",
        "line": "158-169",
        "input": "chunks array",
        "output": "formatted string with [1] Title (similitud: 0.XX)\\nContent",
        "description": "Simple concatenation with index and similarity score. Adds source metadata if present.",
        "errors_possible": "None",
        "latency_ms": "<1",
        "observable_now": "Injected into system instruction (visible in logs if debug)",
        "missing": "No token/char count; no category diversity; no redundancy measure; no provenance traceability to chunk_id"
      },
      {
        "stage": "PROMPT_GENERATION",
        "file": "backend/src/services/geminiService.js",
        "function": "processAssistantMessage",
        "line": "227-950",
        "input": "systemInstruction (BASE + servicesContext + beautyKnowledge), history, userMessage",
        "output": "DeepSeek/Gemini API response with tool calls",
        "description": "DeepSeek primary (with tools), Gemini fallback. Circuit breakers. Semantic cache check. PII sanitization. Tool execution loop.",
        "errors_possible": "DeepSeek API error -> Gemini fallback; Gemini error -> safe_fallback; tool execution errors; circuit breaker open",
        "latency_ms": "~1500-5000 (LLM), +tool calls",
        "observable_now": "Console logs for LLM used, tool calls, cache hit/miss, retrieval latency; ragLogger captures structured trace",
        "missing": "No answer confidence signal; no retrieval->answer linkage; no generation quality metrics (faithfulness, relevancy)"
      },
      {
        "stage": "RESPONSE",
        "file": "backend/src/services/geminiService.js",
        "function": "processAssistantMessage",
        "line": "900-950",
        "input": "aiResponseText, formatted message",
        "output": "WebSocket notification to user, DB insert, semantic cache store",
        "description": "Response delivered via WebSocket, stored in messages table, cached if RAG enabled",
        "errors_possible": "WebSocket failure, DB insert failure, cache store failure",
        "latency_ms": "<50",
        "observable_now": "Console log 'Respuesta de AURA enviada...'; ragLogger trace with total_latency_ms",
        "missing": "No user feedback capture; no response quality signal; no abstention/fallback classification in response"
      },
      {
        "stage": "FALLBACK_ABSTENTION",
        "file": "backend/src/services/geminiService.js + ragService.js",
        "function": "FTS fallback (ragService:124-153), DeepSeek->Gemini fallback (geminiService:590), safe_fallback",
        "line": "124-153, 590-750",
        "input": "Failed vector search / LLM error",
        "output": "FTS results / Gemini response / generic safe response",
        "description": "Three-layer fallback: 1) FTS if vector fails, 2) DeepSeek->Gemini if primary LLM fails, 3) safe_fallback if all fail",
        "errors_possible": "All layers fail -> error logged, generic response",
        "latency_ms": "FTS: ~100-300; Gemini: ~2000-5000",
        "observable_now": "Console warnings; ragLogger captures llm_used='gemini'/'safe_fallback', fallback_triggered",
        "missing": "No explicit abstention signal to user; no retrieval confidence attached to fallback response; no classification of WHY fallback (retrieval vs generation)"
      }
    ]
  },
  "observability_inventory": {
    "existing_signals": {
      "retrieval": [
        "top1_score (via top_chunks[0].similarity_score in ragLogger)",
        "chunks_retrieved (count)",
        "retrieval_latency_ms",
        "fallback_triggered (boolean, via ragLogger migration 047)",
        "filters_applied (JSONB, via migration 047)",
        "threshold_used (numeric, via migration 047)",
        "category (via migration 047)"
      ],
      "query": [
        "query_sanitized (500-char truncated, PII-redacted)",
        "query_embedding_latency_ms",
        "user_id_hash (SHA-256 truncated)"
      ],
      "generation": [
        "llm_used ('deepseek' | 'gemini' | 'safe_fallback' | 'semantic_cache' | 'error')",
        "llm_latency_ms",
        "total_latency_ms",
        "tool_calls (array with name, args_sanitized, latency_ms, success)",
        "cache_hit (boolean, in logRagQuery call from geminiService)"
      ],
      "system": [
        "circuit_breaker_state (per breaker: state, failureCount, nextAttempt)",
        "trace_id (UUID v4)",
        "timestamp (ISO)"
      ]
    },
    "missing_signals": {
      "retrieval": [
        "score_distribution: top5_scores array, top5_mean, top1_top2_gap, top1_top5_gap, score_stddev, score_concentration",
        "candidate_pool_size: chunks before threshold filter",
        "filter_effectiveness: chunks filtered out by metadata",
        "retrieval_mode: 'hnsw' | 'fts' | 'hybrid' (only fallback_triggered boolean exists)",
        "all_scores: array of all similarity scores (migration 047 column exists but not populated)",
        "duplicate_ratio: near-duplicate chunks in results",
        "category_diversity: entropy of categories in top-K"
      ],
      "query": [
        "query_length_chars",
        "query_language_detected",
        "query_category_predicted",
        "trigger_keywords_matched",
        "embedding_vector_available (boolean)"
      ],
      "context": [
        "context_token_count / char_count",
        "context_categories: unique categories in retrieved chunks",
        "context_redundancy: similarity between chunks",
        "chunk_provenance: chunk_id (canonical), document_id, document_version, content_hash, fuente, seccion (migration 046 columns exist but not logged)"
      ],
      "generation": [
        "answer_confidence: NO SIGNAL EXISTS",
        "faithfulness_score: not computed in production",
        "answer_relevancy_score: not computed in production",
        "abstention_signal: no explicit HIGH/LOW/UNSUPPORTED classification",
        "fallback_reason: 'retrieval' vs 'generation' vs 'safety' vs 'circuit_breaker'"
      ],
      "user_feedback": [
        "NO PRODUCTION FEEDBACK LOOP EXISTS",
        "reformulation_rate",
        "abandonment_rate",
        "explicit_rating",
        "clarification_request_rate"
      ]
    }
  },
  "provenance_audit": {
    "current_state": "PARTIAL",
    "traceability_chain": {
      "query_embedding": "trace_id links query to embedding latency, but embedding vector NOT stored",
      "embedding_retrieval": "trace_id links to retrieval results (top_chunks with chunk_id, similarity, category)",
      "retrieval_context": "formatKnowledgeContext uses chunk title+content+similarity; chunk_id passed but NOT logged in context",
      "context_generation": "systemInstruction includes formatted context; but no linkage from generated answer to specific chunks",
      "generation_response": "response stored in messages table; ragLogger traces total_latency but answer text NOT logged (PII-safe)"
    },
    "migrations_available": [
      "046_add_rag_chunk_traceability.sql: document_id, document_version, chunk_id, content_hash, fuente, seccion on beauty_knowledge_embeddings",
      "047_add_rag_query_logs_traceability.sql: category, threshold_used, filters_applied, all_scores, retrieval_mode, fallback_triggered, breaker_state_at_query on rag_query_logs"
    ],
    "gaps": [
      "chunk_id from migration 046 exists in DB but ragService SELECT does not return it (only returns id, title, content, category, similarity)",
      "all_scores column exists but not populated -- would require separate query",
      "retrieval_mode not set -- always 'hnsw' default even when FTS fallback triggers",
      "breaker_state_at_query not captured in logRagQuery call",
      "No linkage from generated answer to specific supporting chunks (no citation IDs in answer)"
    ]
  },
  "fallback_audit": {
    "layers": [
      {
        "layer": 1,
        "name": "FTS Fallback (Retrieval)",
        "trigger": "vector search throws error (network, dimension, timeout)",
        "file": "ragService.js:124-153",
        "behavior": "Executes FTS query with same filters, returns similarity=0.5 constant",
        "observable": "console.warn 'RAG Vectorial fallo. Usando fallback full-text...'",
        "logged": "fallback_triggered=true (if migration 047 active), retrieval_mode='fts' (NOT set)"
      },
      {
        "layer": 2,
        "name": "Gemini Fallback (Generation)",
        "trigger": "DeepSeek API error (circuit breaker open, network, 5xx)",
        "file": "geminiService.js:590-750",
        "behavior": "Re-runs RAG if needed, calls Gemini with Function Calling, uses same tools",
        "observable": "console.log 'Ejecutando fallback a Gemini API...'",
        "logged": "llm_used='gemini' in ragLogger"
      },
      {
        "layer": 3,
        "name": "Safe Fallback (Final)",
        "trigger": "Both DeepSeek and Gemini fail",
        "file": "geminiService.js: catch block ~line 920",
        "behavior": "Returns generic safe response, logs error",
        "observable": "console.error 'Error critico en processAssistantMessage'",
        "logged": "llm_used='error' or 'safe_fallback', error message in ragLogger"
      }
    ],
    "gaps": [
      "No classification of fallback REASON available to user or downstream",
      "FTS fallback returns constant similarity=0.5 -- destroys score signal",
      "No abstention message to user when evidence insufficient",
      "safe_fallback response not distinguishable from normal low-confidence response"
    ]
  },
  "latency_baseline": {
    "stages_measured": [
      "query_embedding_latency_ms: ~200-800 (NVIDIA API)",
      "retrieval_latency_ms: ~50-200 (pgVector), +100-300 if FTS fallback",
      "llm_latency_ms: ~1500-5000 (DeepSeek), ~2000-5000 (Gemini fallback)",
      "total_latency_ms: ~2000-7000 end-to-end"
    ],
    "percentiles_available": "ragMetrics.js computes p50/p95/p99 from rag_query_logs (if table populated)",
    "missing": "No per-stage percentile tracking in real-time; no alerting on latency degradation"
  },
  "gold_dataset_audit": {
    "current": "GOLD-V5 (evaluation_dataset_v5_candidate.json)",
    "queries": 18,
    "supported": 15,
    "unsupported": 3,
    "gold_chunks": 58,
    "categories": ["skincare", "cabello", "cejas", "colorimetria_capilar_tinte"],
    "coverage_vs_production": "UNKNOWN -- no production query distribution available for comparison",
    "limitations": [
      "Only 15 SUPPORTED queries -- small sample for calibration",
      "No colloquial/ambiguous/out-of-domain queries",
      "No explicit negative examples for UNSUPPORTED calibration",
      "No query length / language / complexity distribution documented",
      "Queries are curated expert cases, not real user language"
    ],
    "recommendation": "Design GOLD-R7 as separate dataset: real production queries (anonymized), stratified by category/length/complexity, with explicit SUPPORTED/UNSUPPORTED/AMBIGUOUS labels from human evaluators"
  },
  "risks": [
    "PII: chunk_id in logs -- currently hashed via hashIdForLog (8-char SHA-256), reversible only with rainbow table; LOW risk but verify",
    "No confidence thresholds defined -- any threshold would be arbitrary without calibration data",
    "Semantic cache stores embedding vectors -- ensure Redis TTL and access controls",
    "FTS fallback destroys score signal (constant 0.5) -- cannot calibrate on fallback queries",
    "Distribution shift detection requires production baseline -- not yet established",
    "RAG_TRIGGER_KEYWORDS (80 terms) may miss relevant queries or trigger unnecessarily -- no precision/recall measured"
  ],
  "instrumentation_proposal": {
    "phase": "R7-C2 (post-audit)",
    "schema": "rag_observability_events.jsonl (append-only, rotated daily)",
    "fields": [
      "trace_id",
      "timestamp",
      "user_id_hash",
      "query_hash (SHA-256 of sanitized query)",
      "query_length",
      "trigger_decision: {enabled, matched_keywords, category_predicted}",
      "embedding: {latency_ms, success, dimension, input_type}",
      "retrieval: {mode, latency_ms, candidate_count, top_k, threshold, filters_applied, scores: [top5], score_gap_1_2, score_gap_1_5, score_stddev, category_diversity, duplicate_ratio, fallback_triggered, fallback_reason}",
      "context: {chunk_count, char_count, token_count_est, categories, provenance: [{chunk_id, document_id, similarity}]}",
      "generation: {llm, latency_ms, tool_calls, cache_hit, answer_confidence: {retrieval_confidence, generation_confidence, combined}, abstention_state: 'HIGH_CONFIDENCE'|'LOW_CONFIDENCE'|'UNSUPPORTED', fallback_reason_if_any}",
      "response: {char_count, has_citations, fallback_activated}",
      "circuit_breakers: {nvidia_embeddings, deepseek, gemini: {state, failure_count}}"
    ],
    "storage": "File (dev) / PostgreSQL rag_query_logs (prod) / Redis (semantic cache)",
    "pii_safety": "All IDs hashed (8-char), queries sanitized (piiSanitizer), no embeddings stored in logs, no answer text stored"
  },
  "confidence_model_proposal": {
    "retrieval_confidence_signals": [
      "top1_score",
      "top5_mean",
      "score_gap_1_2",
      "score_gap_1_5",
      "score_stddev",
      "candidate_count",
      "category_diversity",
      "duplicate_ratio",
      "retrieval_mode_penalty: fts=0.5, hybrid=0.8, hnsw=1.0"
    ],
    "generation_confidence_signals": [
      "llm_used penalty: deepseek=1.0, gemini=0.8, safe_fallback=0.1",
      "tool_calls_success_rate",
      "cache_hit bonus (if retrieval_confidence high)"
    ],
    "combined": "weighted geometric mean or calibrated logistic regression -- DEFERRED until signals collected",
    "abstention_thresholds": "NOT DEFINED -- require calibration data (reliability curves, precision/recall by threshold)"
  },
  "r7_c2_recommendation": {
    "name": "R7-C2 -- INSTRUMENTATION DEPLOYMENT & BASELINE COLLECTION",
    "objective": "Deploy observability schema to production (shadow), collect 2-4 weeks of real query data, establish production baseline for confidence calibration",
    "steps": [
      "1. Add retrieval signals to ragLogger (score distribution, candidate count, retrieval_mode, all_scores)",
      "2. Add chunk_id to ragService SELECT and log provenance",
      "3. Populate migration 047 columns: retrieval_mode, all_scores, breaker_state_at_query",
      "4. Add query metadata: length, trigger_keywords, category_predicted",
      "5. Deploy semantic cache stats endpoint",
      "6. Run RAG evaluation suite on production queries (sampled, anonymized)",
      "7. Compare production distribution vs GOLD-V5 (shift detection)",
      "8. Build calibration dataset from production data with human labels"
    ],
    "gates": [
      "RAG tests 69/69 PASS",
      "Global tests baseline maintained (no new failures)",
      "No PII in logs verified",
      "Latency overhead < 5ms per query",
      "Director approval for production shadow deployment"
    ]
  },
  "verification": {
    "rag_tests": "69/69 PASS",
    "global_tests": "263 PASS / 8 FAIL / 1 SKIP (historical baseline)",
    "production_changes": 0,
    "bd_writes": 0,
    "railway_contact": 0,
    "nvidia_unchanged": True,
    "embeddings_untouched": True,
    "corpus_untouched": True
  }
}

path = os.path.join(BASE, "r7c1_observability_audit.json")
with open(path, "w", encoding="utf-8") as f:
    json.dump(audit, f, ensure_ascii=False, indent=2)
print("WROTE", path, os.path.getsize(path), "bytes")

# Validate
with open(path, "r", encoding="utf-8") as f:
    loaded = json.load(f)
assert loaded["cycle"] == "R7-C1"
assert loaded["status"] == "READY_FOR_CALIBRATION"
assert len(loaded["architecture_audit"]["stages"]) == 8
print("VALIDATION: OK")
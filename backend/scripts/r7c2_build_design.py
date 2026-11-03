#!/usr/bin/env python3
"""Build R7-C2 Instrumentation Design Report - READ-ONLY analysis."""
import json, os

BASE = r"C:\beauty-app\backend\src\data\eval"

design = {
  "cycle": "R7-C2",
  "status": "DESIGN_COMPLETE",
  "directive": "R7 — PRODUCTION OBSERVABILITY & CONFIDENCE CALIBRATION — Instrumentation Design Phase",
  "entry_state": {
    "r6": "CLOSED",
    "r7_c1": "CLOSED",
    "r7_c1_verdict": "READY_FOR_CALIBRATION",
    "r6_classification": "REPRESENTATION-BOUND",
    "baseline": {
      "model": "nvidia/nv-embedqa-e5-v5",
      "dimensions": 1024,
      "chunks": 5663,
      "mrr": 0.7222,
      "r5": 0.6156
    }
  },
  "architecture_audit_summary": {
    "flow": "USER_QUERY -> QUERY_NORMALIZATION -> QUERY_EMBEDDING -> VECTOR_SEARCH -> TOP-K -> SCORE_DISTRIBUTION -> CONTEXT_BUILDING -> PROMPT/GENERATION -> RESPONSE -> FALLBACK/ABSTENTION",
    "key_files": {
      "query_normalization": "backend/src/services/geminiService.js:shouldSearchBeautyKnowledge (line 172)",
      "query_embedding": "backend/src/services/embeddingService.js:generateEmbedding (lines 55-146)",
      "vector_search": "backend/src/services/ragService.js:searchBeautyKnowledge (lines 86-155)",
      "score_distribution": "NOT COMPUTED",
      "context_building": "backend/src/services/ragService.js:formatKnowledgeContext (lines 158-169)",
      "prompt_generation": "backend/src/services/geminiService.js:processAssistantMessage (lines 227-950)",
      "response": "backend/src/services/geminiService.js:processAssistantMessage (lines 900-950)",
      "fallback": "ragService.js:124-153 (FTS) + geminiService.js:590-750 (Gemini) + catch block (safe_fallback)"
    }
  },
  "instrumentation_design": {
    "principles": [
      "SHADOW / OBSERVABILITY ONLY — no behavior change",
      "NON-BLOCKING — instrumentation failure must not affect RAG",
      "FAIL-SAFE — swallow/log errors, never throw",
      "PII-MINIMAL — query_hash, user_id_hash, no full text/embeddings",
      "CORRELATION — single trace_id across all stages",
      "VERSIONED SCHEMA — observability_event_version for evolution"
    ],
    "event_schema": {
      "version": "1.0",
      "name": "rag_observability_event",
      "fields": [
        {
          "name": "event_version",
          "type": "string",
          "required": True,
          "description": "Schema version for evolution, e.g., '1.0'"
        },
        {
          "name": "trace_id",
          "type": "string",
          "required": True,
          "description": "UUID v4 from ragLogger.generateTraceId() — correlates all stages"
        },
        {
          "name": "timestamp",
          "type": "string",
          "required": True,
          "description": "ISO 8601 UTC timestamp of event creation"
        },
        {
          "name": "event_type",
          "type": "string",
          "required": True,
          "enum": ["query_received", "embedding_complete", "retrieval_complete", "context_built", "generation_complete", "response_sent", "fallback_triggered", "error"],
          "description": "Lifecycle stage this event represents"
        },
        {
          "name": "user_id_hash",
          "type": "string",
          "required": True,
          "description": "SHA-256 truncated to 8 chars via hashIdForLog()"
        },
        {
          "name": "query_hash",
          "type": "string",
          "required": True,
          "description": "SHA-256 of sanitized query (piiSanitizer output)"
        },
        {
          "name": "query_length",
          "type": "integer",
          "required": True,
          "description": "Character count of original query"
        },
        {
          "name": "language",
          "type": "string",
          "required": False,
          "description": "Detected language code (es/en) — OPTIONAL, not currently available"
        },
        {
          "name": "trigger_decision",
          "type": "object",
          "required": False,
          "description": "Only for event_type=query_received",
          "fields": {
            "enabled": {"type": "boolean", "required": True},
            "matched_keywords": {"type": "array", "items": {"type": "string"}, "required": False},
            "category_predicted": {"type": "string", "required": False}
          }
        },
        {
          "name": "embedding",
          "type": "object",
          "required": False,
          "description": "Only for event_type=embedding_complete",
          "fields": {
            "latency_ms": {"type": "integer", "required": True},
            "success": {"type": "boolean", "required": True},
            "dimension": {"type": "integer", "required": True},
            "input_type": {"type": "string", "enum": ["query", "passage"], "required": True},
            "error": {"type": "string", "required": False}
          }
        },
        {
          "name": "retrieval",
          "type": "object",
          "required": False,
          "description": "Only for event_type=retrieval_complete or fallback_triggered",
          "fields": {
            "mode": {"type": "string", "enum": ["hnsw", "fts", "hybrid", "unknown"], "required": True},
            "latency_ms": {"type": "integer", "required": True},
            "candidate_count": {"type": "integer", "required": False, "description": "Chunks before threshold filter — UNAVAILABLE currently"},
            "top_k": {"type": "integer", "required": True},
            "threshold": {"type": "number", "required": True},
            "filters_applied": {"type": "object", "required": False},
            "scores": {"type": "array", "items": {"type": "number"}, "required": True, "description": "Top-K similarity scores"},
            "score_gap_1_2": {"type": "number", "required": False, "description": "top1 - top2"},
            "score_gap_1_5": {"type": "number", "required": False, "description": "top1 - top5 (or last)"},
            "score_mean": {"type": "number", "required": False},
            "score_median": {"type": "number", "required": False},
            "score_stddev": {"type": "number", "required": False},
            "category_distribution": {"type": "object", "required": False},
            "duplicate_ratio": {"type": "number", "required": False},
            "fallback_triggered": {"type": "boolean", "required": True},
            "fallback_reason": {"type": "string", "enum": ["vector_error", "dimension_mismatch", "timeout", "network", "unknown"], "required": False},
            "fallback_layer": {"type": "integer", "required": False, "description": "1=FTS, 2=Gemini, 3=safe_fallback"}
          }
        },
        {
          "name": "context",
          "type": "object",
          "required": False,
          "description": "Only for event_type=context_built",
          "fields": {
            "chunk_count": {"type": "integer", "required": True},
            "char_count": {"type": "integer", "required": True},
            "token_count_est": {"type": "integer", "required": False, "description": "Approx chars/4"},
            "categories": {"type": "array", "items": {"type": "string"}, "required": False},
            "provenance": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "chunk_id": {"type": "string", "required": False, "description": "Canonical chunk_id from migration 046 — UNAVAILABLE currently"},
                  "document_id": {"type": "string", "required": False},
                  "similarity": {"type": "number", "required": True}
                }
              },
              "required": False
            }
          }
        },
        {
          "name": "generation",
          "type": "object",
          "required": False,
          "description": "Only for event_type=generation_complete",
          "fields": {
            "model": {"type": "string", "enum": ["deepseek", "gemini", "safe_fallback", "semantic_cache"], "required": True},
            "latency_ms": {"type": "integer", "required": True},
            "tool_calls": {"type": "integer", "required": False},
            "cache_hit": {"type": "boolean", "required": False},
            "error": {"type": "string", "required": False}
          }
        },
        {
          "name": "response",
          "type": "object",
          "required": False,
          "description": "Only for event_type=response_sent",
          "fields": {
            "char_count": {"type": "integer", "required": True},
            "has_citations": {"type": "boolean", "required": False, "description": "NOT currently available — no citation IDs in answer"},
            "fallback_activated": {"type": "boolean", "required": True}
          }
        },
        {
          "name": "circuit_breakers",
          "type": "object",
          "required": False,
          "description": "Snapshot at query time",
          "fields": {
            "nvidia_embeddings": {"type": "object", "required": False},
            "deepseek": {"type": "object", "required": False},
            "gemini": {"type": "object", "required": False}
          }
        }
      ]
    },
    "signal_availability": {
      "available_now": [
        "trace_id (ragLogger.generateTraceId)",
        "user_id_hash (piiSanitizer.hashIdForLog)",
        "query_hash (SHA-256 of piiSanitizer output)",
        "query_length (string.length)",
        "trigger_decision.enabled (shouldSearchBeautyKnowledge result)",
        "trigger_decision.matched_keywords (RAG_TRIGGER_KEYWORDS matched)",
        "embedding.latency_ms (measured in geminiService)",
        "embedding.success (try/catch)",
        "embedding.dimension (1024 constant)",
        "embedding.input_type ('query' constant)",
        "retrieval.mode ('hnsw' or 'fts' — detectable via try/catch in searchBeautyKnowledge)",
        "retrieval.latency_ms (measured in geminiService)",
        "retrieval.top_k (5 constant from options)",
        "retrieval.threshold (0.45 constant from options)",
        "retrieval.filters_applied (passed to searchBeautyKnowledge)",
        "retrieval.scores (chunk.similarity from result rows)",
        "retrieval.fallback_triggered (boolean from catch block)",
        "retrieval.fallback_layer (1 if FTS, 2 if Gemini, 3 if safe_fallback)",
        "context.chunk_count (beautyChunks.length)",
        "context.char_count (beautyKnowledge.length)",
        "context.token_count_est (char_count/4)",
        "context.categories (unique chunk.category values)",
        "generation.model (llmUsed variable)",
        "generation.latency_ms (llmLatencyMs variable)",
        "generation.tool_calls (toolCalls.length)",
        "generation.cache_hit (cachedResponse boolean)",
        "response.char_count (aiResponseText.length)",
        "response.fallback_activated (llmUsed != 'deepseek')",
        "circuit_breakers (breakers object state)"
      ],
      "available_with_minor_code_changes": [
        "retrieval.score_gap_1_2 (compute from scores array)",
        "retrieval.score_gap_1_5 (compute from scores array)",
        "retrieval.score_mean/median/stddev (compute from scores array)",
        "retrieval.category_distribution (count categories in results)",
        "retrieval.duplicate_ratio (detect near-duplicate titles/content)",
        "context.provenance (requires ragService SELECT to return chunk_id from migration 046)",
        "trigger_decision.category_predicted (simple keyword->category mapping)",
        "language (simple heuristics or library)"
      ],
      "unavailable_without_schema_changes": [
        "retrieval.candidate_count (requires separate COUNT query before threshold)",
        "retrieval.all_scores (requires separate query without LIMIT/threshold)",
        "chunk_id in provenance (requires migration 046 column + ragService SELECT change)",
        "response.has_citations (requires LLM to output citation IDs — architectural change)",
        "answer_confidence (requires calibration data — future R7-C3)"
      ]
    },
    "correlation_strategy": {
      "trace_id_source": "ragLogger.generateTraceId() — UUID v4",
      "propagation": "Generated once at processAssistantMessage entry, passed through all stages via closure variables",
      "events_per_request": "7-8 (query_received, embedding_complete, retrieval_complete, context_built, generation_complete, response_sent, [fallback_triggered if applicable], [error if applicable])",
      "alternative": "Single consolidated event at end (current ragLogger.logRagQuery approach) — simpler but loses per-stage timing"
    },
    "provenance_strategy": {
      "current_gap": "chunk_id exists in DB (migration 046) but ragService SELECT does not return it",
      "proposed_fix": "Modify searchBeautyKnowledge SQL to include chunk_id, document_id, document_version, content_hash, fuente, seccion",
      "impact": "Minor SELECT change, no behavior change, enables full traceability",
      "fallback": "If chunk_id unavailable, log 'provenance_unavailable': true and use id+title as proxy"
    },
    "fallback_instrumentation": {
      "layer_detection": {
        "layer_1_fts": "Detected in ragService.js catch block — set retrieval.mode='fts', fallback_layer=1",
        "layer_2_gemini": "Detected in geminiService.js DeepSeek catch block — set generation.model='gemini', fallback_layer=2",
        "layer_3_safe": "Detected when aiResponseText uses default — set generation.model='safe_fallback', fallback_layer=3"
      },
      "fallback_reason_classification": {
        "vector_error": "DB error, network, dimension mismatch",
        "timeout": "NVIDIA API timeout or DB query timeout",
        "circuit_breaker": "breaker state OPEN at query time",
        "unknown": "Catch-all"
      },
      "critical_rule": "FTS score (0.5 constant) MUST be tagged with retrieval.mode='fts' and NEVER mixed with dense scores in statistics"
    },
    "pii_policy": {
      "never_store": [
        "Full query text",
        "Full answer text",
        "Embedding vectors",
        "Raw user IDs",
        "Emails, phones, IPs, coordinates, ages, names",
        "Conversation history"
      ],
      "store_instead": [
        "query_hash (SHA-256 of sanitized query)",
        "user_id_hash (SHA-256 truncated 8 chars)",
        "query_length (integer)",
        "language (string, optional)",
        "All scores, latencies, counts, categories"
      ],
      "sanitization": "Use existing piiSanitizer.sanitizeForLog() and hashIdForLog()"
    },
    "sampling_strategy": {
      "analysis": {
        "100_percent": {"pros": "Complete picture, rare events captured", "cons": "High volume, storage cost, PII risk if bug"},
        "10_percent": {"pros": "10x reduction, statistical validity for common patterns", "cons": "May miss rare fallbacks/errors"},
        "1_percent": {"pros": "Low cost", "cons": "Insufficient for calibration, misses rare events"},
        "adaptive": {"pros": "100% for errors/fallbacks/low-score, 10% for normal", "cons": "Complex implementation"}
      },
      "recommendation": "adaptive — 100% for (fallback_triggered OR error OR top1_score < 0.5), 10% for normal. Protects rare events while controlling volume."
    },
    "retention_proposal": {
      "raw_events": "7 days (JSONL files, daily rotation, compressed)",
      "aggregated_metrics": "90 days (PostgreSQL rag_query_logs via ragMetrics.js)",
      "error_events": "180 days (separate error log table/file)",
      "fallback_events": "180 days (for calibration dataset construction)",
      "evaluation_dataset": "Indefinite (GOLD-R7 construction, anonymized, human-labeled)"
    },
    "dataset_design_gold_r7": {
      "purpose": "Future confidence calibration (R7-C3)",
      "requirements": {
        "size": "1000+ queries minimum for statistical validity",
        "stratification": "By category, query length, language, evidence level, fallback status",
        "labels": "SUPPORTED / UNSUPPORTED / AMBIGUOUS / LOW-EVIDENCE / HIGH-EVIDENCE / FALLBACK / ERROR",
        "label_source": "Human evaluators (domain experts) — NOT automatic",
        "pii": "Fully anonymized (query_hash only, no user linkage)"
      },
      "collection_method": "Sample from production observability events (adaptive sampling ensures fallback/error representation)",
      "annotation_tool": "Separate tool/UI — NOT part of R7-C2"
    },
    "metrics_for_collection": [
      "query_volume (total, by category, by hour)",
      "retrieval_latency_p50/p95/p99",
      "generation_latency_p50/p95/p99",
      "total_latency_p50/p95/p99",
      "fallback_rate (by layer, by reason)",
      "error_rate (by type)",
      "empty_response_rate",
      "score_distributions (top1, top5, gaps, stddev) — by mode (hnsw/fts)",
      "candidate_counts (when available)",
      "context_sizes (char/token estimates)",
      "category_distribution (queries and retrieval)",
      "cache_hit_rate",
      "circuit_breaker_state_distribution",
      "distribution_shift_indicators (vs GOLD-V5): query_length, top1_score, score_gap, category, fallback_rate, unsupported_rate, latency"
    ]
  },
  "validation_plan": {
    "local_validation": [
      "Unit test: event schema serialization/deserialization",
      "Integration test: processAssistantMessage with instrumentation enabled produces identical response",
      "Latency overhead test: measure added latency per query (<5ms target)",
      "PII test: verify no full text/embeddings in output events",
      "Fail-safe test: simulate logger failure, verify RAG continues",
      "Correlation test: verify single trace_id across all events for one request"
    ],
    "test_suite_requirements": [
      "RAG suite: 69/69 PASS (no regression)",
      "Global suite: baseline maintained (no new failures)",
      "Instrumentation-specific tests: new tests for observability events"
    ]
  },
  "shadow_deployment_plan": {
    "stages": [
      {
        "stage": "LOCAL_VALIDATION",
        "objective": "Verify instrumentation correctness, no behavior change, latency overhead",
        "duration": "1-2 days",
        "metrics": "RAG tests pass, latency overhead <5ms, PII audit clean",
        "risk": "LOW",
        "rollback": "Disable instrumentation flag"
      },
      {
        "stage": "TEST_ENVIRONMENT",
        "objective": "Validate in staging with realistic load",
        "duration": "3-5 days",
        "metrics": "Event volume, storage, query correctness, fallback capture",
        "risk": "LOW",
        "rollback": "Feature flag off"
      },
      {
        "stage": "SHADOW",
        "objective": "Production shadow mode — events logged but not used for decisions",
        "duration": "2-4 weeks",
        "metrics": "Production baseline characterization, distribution shift detection, dataset building",
        "risk": "MEDIUM (production traffic)",
        "rollback": "Feature flag off, no data loss"
      },
      {
        "stage": "LIMITED_SAMPLE",
        "objective": "If confidence calibration ready, enable for subset of users",
        "duration": "TBD",
        "metrics": "Calibration quality, user impact",
        "risk": "MEDIUM-HIGH",
        "rollback": "Feature flag off"
      },
      {
        "stage": "FULL_OBSERVABILITY",
        "objective": "Full production observability with calibrated confidence",
        "duration": "Ongoing",
        "metrics": "Continuous monitoring, drift detection",
        "risk": "LOW (observability only)",
        "rollback": "Feature flag off"
      }
    ],
    "authorization_required": "STAGE 3 (SHADOW) requires explicit Director approval",
    "stop_conditions": [
      "RAG behavior change detected",
      "Latency overhead > 10ms p99",
      "PII leak detected",
      "Storage growth unbounded",
      "Error rate increase > 1%"
    ]
  },
  "rollback_plan": {
    "mechanism": "Feature flag OBSERVABILITY_ENABLED (env var or config)",
    "scope": "Instant disable — no code deploy needed",
    "data_preservation": "Events already written retained for analysis",
    "verification": "RAG tests pass immediately after disable"
  },
  "r7_c3_recommendation": {
    "name": "R7-C3 — GOLD-R7 CONSTRUCTION & CONFIDENCE CALIBRATION",
    "prerequisite": "R7-C2 shadow deployment complete with 1000+ annotated queries",
    "objective": "Build human-labeled GOLD-R7 dataset, calibrate confidence scoring, validate reliability curves",
    "steps": [
      "1. Extract sampled production queries from observability events",
      "2. Anonymize and present to human evaluators for SUPPORTED/UNSUPPORTED/AMBIGUOUS labeling",
      "3. Build GOLD-R7 dataset (separate from GOLD-V5)",
      "4. Calibrate retrieval confidence signals (reliability curves, precision/recall by threshold)",
      "5. Define abstention thresholds with statistical guarantees",
      "6. Validate on holdout set",
      "7. If calibration successful: design Evidence Aggregator deployment (R7-C4)"
    ]
  },
  "verification": {
    "rag_tests": "69/69 PASS",
    "global_tests": "262 PASS / 9 FAIL / 1 SKIP (historical baseline)",
    "production_changes": 0,
    "bd_writes": 0,
    "railway_contact": 0,
    "nvidia_unchanged": True,
    "embeddings_untouched": True,
    "corpus_untouched": True,
    "instrumentation_deployed": False
  }
}

path = os.path.join(BASE, "r7c2_instrumentation_design.json")
with open(path, "w", encoding="utf-8") as f:
    json.dump(design, f, ensure_ascii=False, indent=2)
print("WROTE", path, os.path.getsize(path), "bytes")

# Validate
with open(path, "r", encoding="utf-8") as f:
    loaded = json.load(f)
assert loaded["cycle"] == "R7-C2"
assert loaded["status"] == "DESIGN_COMPLETE"
assert "instrumentation_design" in loaded
print("VALIDATION: OK")
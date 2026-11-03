# R7-C1 Observability Audit Report

**Ciclo:** R7-C1 | **Estado:** `READY_FOR_CALIBRATION` | **Fase:** Audit only (READ-ONLY)  
**Directiva:** R7 — PRODUCTION OBSERVABILITY & CONFIDENCE CALIBRATION  
**Fecha:** 2026-08-18

---

## Contexto Científico (R6 Cerrado)

| Métrica | Valor |
|---------|-------|
| Modelo oficial | NVIDIA nv-embedqa-e5-v5 (INTACTO) |
| Baseline MRR | 0.7222 |
| Baseline R@5 | 0.6156 |
| VECTOR_MISS | 13/58 (22.4%) |
| Chunks | 5,663 (0 NULL, HNSW OK) |
| RAG Tests | 69/69 PASS |
| Global Tests | 263 PASS / 8 FAIL / 1 SKIP (baseline histórico) |

**Clasificación R6:** `REPRESENTATION-BOUND` — El espacio semántico e5-v5 no ancla consultas coloquiales a 8 conceptos ultraespecializados. Retrieval optimization agotada. Corpus óptimo para embedding actual.

---

## Arquitectura Real Auditada (8 Etapas)

### Flujo Completo
```
USER_QUERY
    ↓
QUERY_NORMALIZATION (shouldSearchBeautyKnowledge, L172 geminiService.js)
    ↓
QUERY_EMBEDDING (generateEmbedding, embeddingService.js:55-146)
    ↓
VECTOR_SEARCH (searchBeautyKnowledge, ragService.js:86-155)
    ↓
SCORE_DISTRIBUTION (NO COMPUTADA)
    ↓
CONTEXT_BUILDING (formatKnowledgeContext, ragService.js:158-169)
    ↓
PROMPT/GENERATION (processAssistantMessage, geminiService.js:227-950)
    ↓
RESPONSE (WebSocket + DB + Cache)
    ↓
FALLBACK/ABSTENTION (3 capas)
```

### Etapas Detalladas

| Etapa | Archivo | Función | Input | Output | Latencia | Observable Ahora | Faltante Crítico |
|-------|---------|---------|-------|--------|----------|------------------|------------------|
| **QUERY_NORMALIZATION** | geminiService.js | `shouldSearchBeautyKnowledge` | userMessageText | boolean | <1ms | Console log chunks | No trigger decision logging; no query length/category |
| **QUERY_EMBEDDING** | embeddingService.js | `generateEmbedding` | text (8000 chars max), input_type='query' | vector[1024] | ~200-800ms | Retry warns; circuit breaker | No latency histogram; no embedding stored; no input_type logged |
| **VECTOR_SEARCH** | ragService.js | `searchBeautyKnowledge` | queryEmbedding, {topK=5, threshold=0.45, filters} | chunks[] con similarity | ~50-200ms | Chunk titles; fallback warn | **No score distribution**; no candidate count; no filter effectiveness; no retrieval_mode |
| **SCORE_DISTRIBUTION** | — | **NO EXISTE** | chunks con similarity | — | — | Solo top1 visible | **TODAS las señales**: top5, gaps, stddev, concentración |
| **CONTEXT_BUILDING** | ragService.js | `formatKnowledgeContext` | chunks[] | formatted string | <1ms | En system instruction | No token count; no category diversity; no provenance a chunk_id |
| **PROMPT/GENERATION** | geminiService.js | `processAssistantMessage` | systemInstruction + history + userMsg | DeepSeek/Gemini response + tools | ~1500-5000ms | LLM used, tools, cache, retrieval latency | No answer confidence; no retrieval→answer linkage; no faithfulness/relevancy |
| **RESPONSE** | geminiService.js | `processAssistantMessage` | aiResponseText | WebSocket + DB insert + cache | <50ms | "Respuesta enviada" log | No user feedback; no quality signal; no abstention classification |
| **FALLBACK/ABSTENTION** | ragService.js + geminiService.js | 3 capas | Error previo | FTS / Gemini / safe_fallback | FTS: 100-300ms; Gemini: 2000-5000ms | Console warns; llm_used en logger | No fallback reason expuesto; FTS destruye score (0.5 const); no abstention message |

---

## Inventario de Observabilidad

### Señales EXISTENTES (Actualmente capturadas en ragLogger/rag_query_logs)

#### Retrieval
- `top1_score` (via top_chunks[0].similarity_score)
- `chunks_retrieved` (count)
- `retrieval_latency_ms`
- `fallback_triggered` (boolean, migración 047)
- `filters_applied` (JSONB, migración 047)
- `threshold_used` (numeric, migración 047)
- `category` (migración 047)

#### Query
- `query_sanitized` (500 chars, PII-redacted)
- `query_embedding_latency_ms`
- `user_id_hash` (SHA-256 truncado)

#### Generación
- `llm_used` ('deepseek'\|'gemini'\|'safe_fallback'\|'semantic_cache'\|'error')
- `llm_latency_ms`
- `total_latency_ms`
- `tool_calls` (array con name, args_sanitized, latency_ms, success)
- `cache_hit` (boolean)

#### Sistema
- `circuit_breaker_state` (por breaker: state, failureCount, nextAttempt)
- `trace_id` (UUID v4)
- `timestamp` (ISO)

### Señales FALTANTES (Críticas para calibración)

| Categoría | Señales Faltantes |
|-----------|-------------------|
| **Retrieval** | score_distribution (top5_scores, top5_mean, gap_1_2, gap_1_5, stddev, concentración), candidate_pool_size (antes de threshold), filter_effectiveness, retrieval_mode ('hnsw'\|'fts'\|'hybrid'), all_scores array, duplicate_ratio, category_diversity |
| **Query** | query_length_chars, query_language, query_category_predicted, trigger_keywords_matched, embedding_vector_available |
| **Context** | context_token_count/char_count, context_categories, context_redundancy, chunk_provenance (chunk_id canónico, document_id, document_version, content_hash, fuente, seccion) |
| **Generación** | **answer_confidence: NO EXISTE**, faithfulness_score, answer_relevancy_score, abstention_signal (HIGH/LOW/UNSUPPORTED), fallback_reason ('retrieval'\|'generation'\|'safety'\|'circuit_breaker') |
| **User Feedback** | **NO HAY FEEDBACK LOOP**: reformulation_rate, abandonment_rate, explicit_rating, clarification_request_rate |

---

## Provenance Audit

**Estado actual:** `PARTIAL`

### Cadena de Trazabilidad
```
query → embedding: trace_id vincula query a embedding latency (vector NO almacenado)
    ↓
embedding → retrieval: trace_id vincula a resultados (top_chunks con chunk_id, similarity, category)
    ↓
retrieval → context: formatKnowledgeContext usa title+content+similarity; chunk_id NO loggeado en contexto
    ↓
context → generation: systemInstruction incluye contexto formateado; SIN vinculación answer→chunks específicos
    ↓
generation → response: respuesta en messages table; ragLogger traza total_latency; answer text NO loggeado (PII-safe)
```

### Migraciones Disponibles (NO pobladas completamente)
- **046**: document_id, document_version, chunk_id, content_hash, fuente, seccion en beauty_knowledge_embeddings
- **047**: category, threshold_used, filters_applied, all_scores, retrieval_mode, fallback_triggered, breaker_state_at_query en rag_query_logs

### Gaps Críticos
1. `chunk_id` existe en BD pero ragService SELECT no lo retorna
2. `all_scores` columna existe pero no se popula
3. `retrieval_mode` siempre 'hnsw' default aunque FTS fallback active
4. `breaker_state_at_query` no capturado en logRagQuery
5. **Sin citas en respuesta**: no hay linkage answer→supporting chunks

---

## Fallback Audit (3 Capas)

| Capa | Trigger | Comportamiento | Señal Destruida | Logged |
|------|---------|----------------|-----------------|--------|
| **1. FTS (Retrieval)** | Vector error | FTS con mismos filtros, similarity=0.5 const | **Score signal destruido** | fallback_triggered=true; retrieval_mode NO seteado |
| **2. Gemini (Generación)** | DeepSeek error | Re-ejecuta RAG si needed, llama Gemini con Function Calling | — | llm_used='gemini' |
| **3. Safe Fallback** | Ambos fallan | Respuesta genérica segura | — | llm_used='error'/'safe_fallback' |

**Gaps:** No clasificación de reason expuesta; no abstention message a usuario; safe_fallback indistinguible de low-confidence normal.

---

## Latency Baseline

| Stage | Rango | Percentiles |
|-------|-------|-------------|
| query_embedding | ~200-800ms | ragMetrics.js calcula p50/p95/p99 si tabla poblada |
| retrieval | ~50-200ms (+100-300 FTS) | Disponible via ragMetrics |
| LLM (DeepSeek) | ~1500-5000ms | Disponible |
| LLM (Gemini fallback) | ~2000-5000ms | Disponible |
| **Total end-to-end** | **~2000-7000ms** | **Disponible** |

**Faltante:** No per-stage percentile tracking real-time; no alerting on latency degradation.

---

## GOLD-V5 Dataset Audit

| Métrica | Valor |
|---------|-------|
| Queries totales | 18 |
| SUPPORTED | 15 |
| UNSUPPORTED | 3 |
| Gold chunks | 58 |
| Categorías | skincare, cabello, cejas, colorimetria_capilar_tinte |

**Limitaciones para Calibración:**
- Solo 15 SUPPORTED — muestra pequeña
- Sin queries coloquiales/ambiguas/out-of-domain
- Sin negativos explícitos para calibrar UNSUPPORTED
- Sin distribución de length/language/complexity
- Queries curadas expertas, no lenguaje real usuario

**Recomendación:** Diseñar **GOLD-R7** separado: queries reales producción (anonimizadas), estratificadas por categoría/length/complexity, con labels SUPPORTED/UNSUPPORTED/AMBIGUOUS de evaluadores humanos.

---

## Riesgos Identificados

1. **PII**: chunk_id en logs → hasheado 8-char SHA-256 (LOW risk, verificar)
2. **Thresholds arbitrarios**: Sin datos calibración, cualquier threshold es guess
3. **Semantic cache**: Almacena embedding vectors → verificar Redis TTL/access controls
4. **FTS fallback**: Destruye score signal (0.5 const) → no calibrable
5. **Distribution shift**: Requiere baseline producción → no establecido
6. **RAG_TRIGGER_KEYWORDS** (80 términos): Puede miss relevant queries o trigger innecesario → precision/recall no medido

---

## Propuesta de Instrumentación (R7-C2)

### Esquema: `rag_observability_events.jsonl` (append-only, rotado daily)

```json
{
  "trace_id": "uuid",
  "timestamp": "ISO",
  "user_id_hash": "sha256_8",
  "query_hash": "sha256(sanitized_query)",
  "query_length": 120,
  "trigger_decision": {"enabled": true, "matched_keywords": ["piel", "rutina"], "category_predicted": "skincare"},
  "embedding": {"latency_ms": 450, "success": true, "dimension": 1024, "input_type": "query"},
  "retrieval": {
    "mode": "hnsw",
    "latency_ms": 85,
    "candidate_count": 234,
    "top_k": 5,
    "threshold": 0.45,
    "filters_applied": {"category": "skincare"},
    "scores": [0.62, 0.58, 0.55, 0.51, 0.49],
    "score_gap_1_2": 0.04,
    "score_gap_1_5": 0.13,
    "score_stddev": 0.05,
    "category_diversity": 0.8,
    "duplicate_ratio": 0.0,
    "fallback_triggered": false,
    "fallback_reason": null
  },
  "context": {
    "chunk_count": 5,
    "char_count": 2847,
    "token_count_est": 712,
    "categories": ["skincare", "ingredientes"],
    "provenance": [{"chunk_id": "abc123", "document_id": "doc_001", "similarity": 0.62}]
  },
  "generation": {
    "llm": "deepseek",
    "latency_ms": 2340,
    "tool_calls": [{"name": "search_beauty_knowledge_rag", "latency_ms": 120, "success": true}],
    "cache_hit": false,
    "answer_confidence": {"retrieval_confidence": 0.78, "generation_confidence": 0.85, "combined": 0.81},
    "abstention_state": "HIGH_CONFIDENCE",
    "fallback_reason_if_any": null
  },
  "response": {"char_count": 847, "has_citations": true, "fallback_activated": false},
  "circuit_breakers": {"nvidia_embeddings": {"state": "closed", "failure_count": 0}, "deepseek": {"state": "closed", "failure_count": 0}, "gemini": {"state": "closed", "failure_count": 0}}
}
```

### PII Safety
- IDs: hash 8-char SHA-256
- Queries: piiSanitizer (emails, phones, IPs, ages, coords redacted)
- NO embeddings en logs
- NO answer text en logs

---

## Confidence Model Proposal (Deferred Until Calibration Data)

### Retrieval Confidence Signals
- `top1_score`, `top5_mean`, `score_gap_1_2`, `score_gap_1_5`, `score_stddev`
- `candidate_count`, `category_diversity`, `duplicate_ratio`
- `retrieval_mode_penalty`: fts=0.5, hybrid=0.8, hnsw=1.0

### Generation Confidence Signals
- `llm_used penalty`: deepseek=1.0, gemini=0.8, safe_fallback=0.1
- `tool_calls_success_rate`
- `cache_hit bonus` (si retrieval_confidence high)

### Combined
- Weighted geometric mean o calibrated logistic regression — **DEFERRED**

### Abstention Thresholds
- **NOT DEFINED** — requieren calibration data (reliability curves, precision/recall by threshold)

---

## R7-C2 Recommendation

### Objetivo
Deploy observability schema to production (shadow), collect 2-4 weeks real query data, establish production baseline for confidence calibration.

### Steps
1. Add retrieval signals to ragLogger (score distribution, candidate count, retrieval_mode, all_scores)
2. Add chunk_id to ragService SELECT and log provenance
3. Populate migration 047 columns: retrieval_mode, all_scores, breaker_state_at_query
4. Add query metadata: length, trigger_keywords, category_predicted
5. Deploy semantic cache stats endpoint
6. Run RAG evaluation suite on production queries (sampled, anonymized)
7. Compare production distribution vs GOLD-V5 (shift detection)
8. Build calibration dataset from production data with human labels

### Gates
- [ ] RAG tests 69/69 PASS
- [ ] Global tests baseline maintained
- [ ] No PII in logs verified
- [ ] Latency overhead < 5ms per query
- [ ] **Director approval** for production shadow deployment

---

## Verificación Final

| Check | Resultado |
|-------|-----------|
| JSON parse | ✅ `backend/src/data/eval/r7c1_observability_audit.json` válido |
| Schema validation | ✅ cycle=R7-C1, status=READY_FOR_CALIBRATION, 8 stages |
| RAG Suite | **69/69 PASS** ✅ |
| Global Suite | **263 PASS / 8 FAIL / 1 SKIP** (baseline histórico intacto) |
| Production changes | 0 ✅ |
| BD writes | 0 ✅ |
| Railway contact | 0 ✅ |
| NVIDIA e5-v5 | Intacto ✅ |
| Embeddings | Sin tocar ✅ |
| Corpus | Sin tocar ✅ |

---

## VEREDICTO R7-C1

**`READY_FOR_CALIBRATION`**

La auditoría identificó:
- Arquitectura real mapeada end-to-end (8 etapas)
- 15+ señales existentes, 25+ señales faltantes críticas
- Provenance PARTIAL — migraciones 046/047 disponibles pero no pobladas
- 3 capas fallback auditadas — FTS destruye score signal
- GOLD-V5 insuficiente para calibración — requiere GOLD-R7 real
- Modelo de confidence propuesto (deferred hasta datos)

**Próximo paso:** R7-C2 — INSTRUMENTATION DEPLOYMENT & BASELINE COLLECTION (pendiente aprobación Director para shadow deployment).

**NO implementar aún:** confidence thresholds, Evidence Aggregator, EvidencePacket production, adaptive retrieval, new embedding model, corpus expansion, reranking, FTS, query expansion.
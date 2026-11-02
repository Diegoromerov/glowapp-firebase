# R7-C2 Instrumentation Design Report

**Ciclo:** R7-C2 | **Estado:** `DESIGN_COMPLETE` | **Fase:** Design Only (READ-ONLY)  
**Directiva:** R7 — PRODUCTION OBSERVABILITY & CONFIDENCE CALIBRATION  
**Fecha:** 2026-08-18

---

## Estado de Entrada

| Componente | Estado |
|------------|--------|
| R6 | CLOSED |
| R7-C1 | CLOSED |
| R7-C1 Veredicto | READY_FOR_CALIBRATION |
| Clasificación R6 | REPRESENTATION-BOUND |

### Baseline Confirmado
- **Modelo:** NVIDIA nv-embedqa-e5-v5 (1024d, NIM managed API)
- **Chunks:** 5,663 (0 NULL, HNSW operacional)
- **MRR:** 0.7222
- **R@5:** 0.6156
- **VECTOR_MISS:** 13/58

---

## Arquitectura Auditada (Resumen)

```
USER_QUERY
    ↓
QUERY_NORMALIZATION (geminiService.js:shouldSearchBeautyKnowledge L172)
    ↓
QUERY_EMBEDDING (embeddingService.js:generateEmbedding L55-146)
    ↓
VECTOR_SEARCH (ragService.js:searchBeautyKnowledge L86-155)
    ↓
SCORE_DISTRIBUTION (NO COMPUTADA)
    ↓
CONTEXT_BUILDING (ragService.js:formatKnowledgeContext L158-169)
    ↓
PROMPT/GENERATION (geminiService.js:processAssistantMessage L227-950)
    ↓
RESPONSE (geminiService.js L900-950)
    ↓
FALLBACK/ABSTENTION (3 capas: FTS → Gemini → safe_fallback)
```

---

## Diseño de Instrumentación

### Principios Fundamentales
1. **SHADOW / OBSERVABILITY ONLY** — No comportamiento change
2. **NON-BLOCKING** — Fallo de instrumentación no afecta RAG
3. **FAIL-SAFE** — Swallow/log errors, never throw
4. **PII-MINIMAL** — query_hash, user_id_hash, no texto completo/embeddings
5. **CORRELATION** — Single trace_id across all stages
6. **VERSIONED SCHEMA** — observability_event_version para evolución

### Esquema de Evento (v1.0)

**Campos Core (Siempre presentes):**
- `event_version`: "1.0"
- `trace_id`: UUID v4 (correlaciona todas las etapas)
- `timestamp`: ISO 8601 UTC
- `event_type`: Enum de 8 tipos (query_received, embedding_complete, retrieval_complete, context_built, generation_complete, response_sent, fallback_triggered, error)
- `user_id_hash`: SHA-256 truncado 8 chars
- `query_hash`: SHA-256 de query sanitizada
- `query_length`: Integer

**Campos por Tipo de Evento:**

| Event Type | Campos Específicos |
|------------|-------------------|
| query_received | trigger_decision {enabled, matched_keywords[], category_predicted} |
| embedding_complete | embedding {latency_ms, success, dimension, input_type, error?} |
| retrieval_complete | retrieval {mode, latency_ms, top_k, threshold, filters_applied, scores[], score_gap_1_2, score_gap_1_5, score_mean, score_median, score_stddev, category_distribution, duplicate_ratio, fallback_triggered, fallback_reason?, fallback_layer?} |
| context_built | context {chunk_count, char_count, token_count_est, categories[], provenance[{chunk_id?, document_id?, similarity}]} |
| generation_complete | generation {model, latency_ms, tool_calls, cache_hit, error?} |
| response_sent | response {char_count, has_citations?, fallback_activated} |
| fallback_triggered | retrieval (con fallback_layer y fallback_reason) |
| error | error message, stage |

### Disponibilidad de Señales

#### ✅ Disponibles AHORA (sin cambios de código)
- trace_id, user_id_hash, query_hash, query_length
- trigger_decision.enabled, matched_keywords
- embedding: latency_ms, success, dimension=1024, input_type='query'
- retrieval: mode (hnsw/fts detectable), latency_ms, top_k=5, threshold=0.45, filters_applied, scores[], fallback_triggered, fallback_layer
- context: chunk_count, char_count, token_count_est, categories[]
- generation: model, latency_ms, tool_calls, cache_hit
- response: char_count, fallback_activated
- circuit_breakers snapshot

#### 🔧 Disponibles con CAMBIOS MENORES
- retrieval: score_gap_1_2, score_gap_1_5, score_mean/median/stddev, category_distribution, duplicate_ratio
- context: provenance (requiere ragService SELECT → chunk_id de migración 046)
- trigger_decision: category_predicted (keyword→category mapping simple)
- language (heurística simple)

#### ❌ NO Disponibles sin CAMBIOS DE ESQUEMA
- retrieval.candidate_count (requiere COUNT query separada)
- retrieval.all_scores (requiere query sin LIMIT/threshold)
- chunk_id en provenance (requiere migración 046 + SELECT change)
- response.has_citations (requiere LLM output citation IDs — cambio arquitectónico)
- answer_confidence (requiere datos calibración — futuro R7-C3)

### Estrategia de Correlación
- **trace_id**: ragLogger.generateTraceId() — UUID v4
- **Propagación**: Generado una vez en processAssistantMessage, pasado via closure variables
- **Eventos por request**: 7-8 eventos (o 1 consolidado al final — trade-off granularidad vs simplicidad)

### Estrategia de Provenance
**Gap actual**: chunk_id existe en BD (migración 046) pero ragService no lo retorna.
**Fix propuesto**: Modificar SQL en searchBeautyKnowledge para incluir chunk_id, document_id, document_version, content_hash, fuente, seccion.
**Impacto**: Cambio menor SELECT, sin cambio comportamiento, habilita trazabilidad completa.

### Instrumentación de Fallback
| Capa | Detección | Métricas |
|------|-----------|----------|
| 1. FTS | ragService.js catch block | mode='fts', fallback_layer=1 |
| 2. Gemini | geminiService.js DeepSeek catch | model='gemini', fallback_layer=2 |
| 3. Safe | aiResponseText default | model='safe_fallback', fallback_layer=3 |

**Regla Crítica**: FTS score (0.5 const) MUST be tagged mode='fts' y NUNCA mezclado con dense scores en estadísticas.

### PII Policy
**NUNCA almacenar**: query text completo, answer text, embeddings, user IDs raw, emails, phones, IPs, coords, ages, names, historial.
**ALMACENAR**: query_hash, user_id_hash, query_length, language, scores, latencias, counts, categories.
**Sanitización**: piiSanitizer.sanitizeForLog() + hashIdForLog() existentes.

### Sampling Strategy
**Recomendación: Adaptive**
- 100% para: fallback_triggered OR error OR top1_score < 0.5
- 10% para: queries normales
**Rationale**: Protege eventos raros (fallbacks, errors, low-score) mientras controla volumen.

### Retención
| Datos | Retención |
|-------|-----------|
| Raw events (JSONL) | 7 días (rotación daily, comprimidos) |
| Métricas agregadas | 90 días (PostgreSQL rag_query_logs) |
| Eventos error | 180 días |
| Eventos fallback | 180 días (para dataset calibración) |
| Evaluation dataset (GOLD-R7) | Indefinido (anonimizado, human-labeled) |

### Diseño Dataset GOLD-R7 (Futuro R7-C3)
- **Tamaño**: 1000+ queries mínimo
- **Estratificación**: Categoría, longitud, idioma, nivel evidencia, estado fallback
- **Labels**: SUPPORTED / UNSUPPORTED / AMBIGUOUS / LOW-EVIDENCE / HIGH-EVIDENCE / FALLBACK / ERROR
- **Fuente labels**: Evaluadores humanos (expertos dominio) — NO automático
- **PII**: Totalmente anonimizado (solo query_hash, sin linkage usuario)

### Métricas para Colección
- Query volume (total, por categoría, por hora)
- Latencias p50/p95/p99 (retrieval, generation, total)
- Fallback rate (por capa, por razón)
- Error rate (por tipo)
- Empty response rate
- **Score distributions** (top1, top5, gaps, stddev) — POR MODO (hnsw/fts separados)
- Candidate counts (cuando disponible)
- Context sizes (chars/tokens)
- Category distribution (queries y retrieval)
- Cache hit rate
- Circuit breaker state distribution
- **Distribution shift indicators** (vs GOLD-V5): query_length, top1_score, score_gap, category, fallback_rate, unsupported_rate, latency

---

## Plan de Validación Local

### Tests Requeridos
1. **Unit**: Event schema serialization/deserialization
2. **Integration**: processAssistantMessage con instrumentación → respuesta idéntica
3. **Latency**: Overhead < 5ms p99
4. **PII**: Zero full text/embeddings en output
5. **Fail-safe**: Logger failure → RAG continúa
6. **Correlation**: Single trace_id across all events

### Gates de Suite
- RAG: 69/69 PASS
- Global: Baseline mantenido (no nuevos fallos)
- Tests instrumentación-specific: PASS

---

## Plan de Shadow Deployment

| Etapa | Objetivo | Duración | Riesgo | Autorización |
|-------|----------|----------|--------|--------------|
| LOCAL_VALIDATION | Correctness, no behavior change | 1-2 días | LOW | Auto |
| TEST_ENV | Realistic load validation | 3-5 días | LOW | Auto |
| **SHADOW** | **Production baseline characterization** | **2-4 semanas** | **MEDIUM** | **DIRECTOR REQUIRED** |
| LIMITED_SAMPLE | Calibración confidence subset users | TBD | MEDIUM-HIGH | DIRECTOR |
| FULL_OBSERVABILITY | Continuous monitoring | Ongoing | LOW | Auto |

**STOP Conditions:**
- RAG behavior change detectado
- Latency overhead > 10ms p99
- PII leak detectado
- Storage growth unbounded
- Error rate increase > 1%

---

## Rollback Plan
- **Mecanismo**: Feature flag `OBSERVABILITY_ENABLED` (env var)
- **Alcance**: Instant disable — no code deploy
- **Data preservation**: Eventos ya escritos retenidos
- **Verificación**: RAG tests pass inmediatamente tras disable

---

## Recomendación R7-C3

**Nombre:** R7-C3 — GOLD-R7 CONSTRUCTION & CONFIDENCE CALIBRATION  
**Prerequisito:** R7-C2 shadow deployment complete con 1000+ queries anotadas  
**Objetivo:** Build GOLD-R7 dataset, calibrar confidence scoring, validar reliability curves  
**Pasos:** Extraer queries producción → Anonimizar → Etiquetado humano → Calibrar señales → Definir thresholds con garantías estadísticas → Validar holdout → Si exitoso: Evidence Aggregator (R7-C4)

---

## Verificación Final

| Check | Resultado |
|-------|-----------|
| JSON parse | ✅ `backend/src/data/eval/r7c2_instrumentation_design.json` válido |
| Schema validation | ✅ cycle=R7-C2, status=DESIGN_COMPLETE, instrumentation_design present |
| RAG Suite | **69/69 PASS** ✅ |
| Global Suite | **262 PASS / 9 FAIL / 1 SKIP** (baseline histórico intacto) |
| Production changes | 0 ✅ |
| BD writes | 0 ✅ |
| Railway contact | 0 ✅ |
| NVIDIA e5-v5 | Intacto ✅ |
| Embeddings | Sin tocar ✅ |
| Corpus | Sin tocar ✅ |
| Instrumentación desplegada | **NO** (design only) ✅ |

---

## VEREDICTO R7-C2

**`DESIGN_COMPLETE`** — Instrumentación diseñada end-to-end con:
- Schema versionado v1.0 con 8 event types
- 30+ señales mapeadas (disponibles / minor changes / schema changes)
- Estrategia correlación trace_id única
- Provenance fix identificado (migración 046 + SELECT)
- Fallback instrumentation con layer/reason classification
- PII policy estricta (hash + sanitization)
- Adaptive sampling (protege rare events)
- Retención por capas
- GOLD-R7 dataset design para futuro
- Métricas + distribution shift indicators
- Validation plan + gates
- 5-stage shadow deployment plan (STAGE 3 requiere Director approval)
- Rollback instantáneo via feature flag
- R7-C3 recommendation condicionada a datos

**PRÓXIMO PASO:** Presentar plan a Director para autorización **STAGE 3 SHADOW DEPLOYMENT**.

**NO IMPLEMENTAR AÚN:** Confidence thresholds, Evidence Aggregator, retrieval changes, embedding changes, corpus changes, producción deployment sin autorización.
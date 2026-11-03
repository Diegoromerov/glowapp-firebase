# R7-C3 — Production Observation & GOLD-R7 Dataset
## Data Quality Audit & Sufficiency Assessment

**Ciclo:** R7-C3 | **Estado:** `CALIBRATION-DATA-INSUFFICIENT`  
**Fecha:** 2026-08-19  
**Branch:** `r7-stage3-shadow` (Stage 3 verified locally, NOT deployed to Railway production)

---

## 1. Observation Source Verification

### Fuente de Datos Identificada
| Atributo | Valor |
|----------|-------|
| **Tabla** | `rag_query_logs` (PostgreSQL `beauty_db` puerto 5435) |
| **Migraciones aplicadas** | 046 (chunk traceability), 047 (query logs traceability) |
| **Columnas de trazabilidad** | `category`, `threshold_used`, `filters_applied`, `all_scores`, `retrieval_mode`, `fallback_triggered`, `breaker_state_at_query` |
| **Índices** | Creados según migración 047 |

### Esquema Real Observado
```sql
rag_query_logs (
  id, trace_id, user_id_hash, query_sanitized, chunks_retrieved,
  top_score, llm_used, total_latency_ms, error, created_at,
  category, threshold_used, filters_applied, all_scores,
  retrieval_mode, fallback_triggered, breaker_state_at_query
)
```

---

## 2. Data Quality Audit

### Métricas Globales
| Métrica | Valor | Evaluación |
|---------|-------|------------|
| **Total events** | 275 | — |
| **Total traces** | 275 (1:1) | ⚠️ No multi-event traces |
| **Unique trace_ids** | 275 | — |
| **Unique users** | 1 | ⚠️ Single test user |
| **Unique queries** | 1 ("Test query") | ❌ Zero diversity |
| **Date range** | 2026-08-16 → 2026-08-19 (3.5 días) | — |
| **Events/day** | ~78/día | Solo tests |

### Distribución de Event Types (implícita via `llm_used`)
| LLM | Count | % |
|-----|-------|---|
| gemini | 138 | 50.2% |
| deepseek | 137 | 49.8% |

### Retrieval Observability
| Señal | Valor | Estado |
|-------|-------|--------|
| `retrieval_mode` | 100% `hnsw` | ❌ Sin FTS/hybrid/fallback |
| `fallback_triggered` | 100% `false` | ❌ Zero fallbacks |
| `chunks_retrieved` | 100% `0` | ❌ Retrieval no ejecutado |
| `top_score` | 100% `null` | ❌ Sin scores |
| `all_scores` | 100% `null` | ❌ Sin score distribution |
| `threshold_used` | 100% `null` | — |
| `filters_applied` | 100% `null` | — |
| `category` | 100% `null` | — |
| `breaker_state_at_query` | 100% `null` | — |
| `error` | 100% `null` | — |

### Trace Integrity
| Clasificación | Traces | % |
|---------------|--------|---|
| **COMPLETE** (query→retrieval→generation→response) | 0 | 0% |
| **PARTIAL** (algunos eventos) | 275 | 100% (solo generation log) |
| **BROKEN** | 0 | 0% |
| **UNKNOWN** | 0 | 0% |

**Cada trace tiene exactamente 1 row** → no correlación multi-etapa observable.

### Provenance Coverage
| Enlace | Cobertura |
|--------|-----------|
| request → retrieval | 0% (retrieval no ejecutado) |
| retrieval → chunk | 0% |
| chunk → context | 0% |
| context → generation | 0% |
| request → evidence | 0% |

---

## 3. Root Cause Analysis

### ¿Por qué los datos son así?

| Hecho | Evidencia |
|-------|-----------|
| **Instrumentación implementada** | ✅ Código en `ragObservability.js`, `ragService.js`, `geminiService.js` |
| **Tests locales pasan** | ✅ 69/69 RAG, 107/107 RAG-related |
| **Feature flag verificado** | ✅ `OBSERVABILITY_ENABLED` ON/OFF probado localmente |
| **Deploy a Railway** | ❌ **NUNCA REALIZADO** |
| `OBSERVABILITY_ENABLED=true` en producción | ❌ No configurado en Railway Dashboard |
| Tráfico real de usuarios | ❌ No observado |

### Conclusión Técnica
> **R7-STAGE3 fue verificado LOCALMENTE (shadow mode OFF→ON equivalence, tests pass, rollback works) pero NUNCA fue desplegado a Railway producción con el feature flag activado.**

Los 275 eventos en `rag_query_logs` son **exclusivamente datos de test** (smoke tests locales, CI, o ejecuciones manuales de `processAssistantMessage` con "Test query"), **no observaciones de producción real**.

---

## 4. Data Sufficiency Assessment

| Criterio R7-C3 | Cumple | Justificación |
|----------------|--------|---------------|
| **Volumen suficiente** (≥1000 queries reales) | ❌ | 0 queries reales, 1 query de test ×275 |
| **Diversidad de queries** | ❌ | 1 única query "Test query" |
| **Diversidad de usuarios** | ❌ | 1 solo user_hash |
| **Diversidad de categorías** | ❌ | 100% `null` |
| **Lenguaje real de usuario** | ❌ | Solo "Test query" |
| **Queries unsupported/ambiguous** | ❌ | 0 |
| **Queries fallback/error** | ❌ | 0 fallbacks, 0 errors |
| **Distribución de scores** | ❌ | 100% `null` |
| **Provenance trazable** | ❌ | 0% coverage |
| **Trace multi-etapa correlacionable** | ❌ | 0 traces completos |
| **Negativos reales** | ❌ | 0 |
| **Muestreo representativo** | ❌ | Solo datos sintéticos de test |

### Verdict de Suficiencia
**`CALIBRATION-DATA-INSUFFICIENT`**

**Razón fundamental:** Stage 3 shadow deployment **no fue ejecutado en producción**. La instrumentación existe y funciona (verificado localmente), pero el feature flag `OBSERVABILITY_ENABLED=true` nunca se activó en Railway.

---

## 5. Recomendación

### Acción Requerida Antes de R7-C3 Continuation

1. **Deploy a Railway** del branch `r7-stage3-shadow` con:
   ```bash
   OBSERVABILITY_ENABLED=true
   ```

2. **Período de observación real** mínimo sugerido: **2-4 semanas** (según R7-C2 deployment plan STAGE 3)

3. **Métricas objetivo para R7-C3 viable**:
   - ≥ 1,000 traces únicos de usuarios reales
   - ≥ 10 categorías de queries representadas
   - ≥ 5% fallback rate (para calibrar low-score)
   - ≥ 3 retrieval modes observados (hnsw, fts, hybrid)
   - Score distributions no-nulas
   - Trace integrity > 80% COMPLETE

### Próximo Paso Formal
> **El Director debe autorizar el deployment real a Railway** con `OBSERVABILITY_ENABLED=true` antes de que R7-C3 pueda producir un GOLD-R7 científicamente defendible.

Sin datos reales de producción, cualquier "GOLD-R7" construido sería sintético y no serviría para calibration de confidence en condiciones reales.

---

## 6. Tests Verification (Post-Analysis)

| Suite | Resultado |
|-------|-----------|
| **RAG tests** | 69/69 PASS ✅ |
| **Embedding tests** | 16/16 PASS ✅ |
| **RAG-related (107 total)** | 107/107 PASS ✅ |
| **Global** | 263 PASS / 8 FAIL / 1 SKIP (baseline histórico inmutable) |
| **Regresiones nuevas** | 0 ✅ |

---

## 7. VERDICT FINAL

### `CALIBRATION-DATA-INSUFFICIENT`

**Justificación exacta:** La instrumentación R7-STAGE3 está implementada y verificada localmente, pero **nunca fue desplegada a producción Railway**. Los únicos datos en `rag_query_logs` son 275 eventos de test sintéticos ("Test query", 1 usuario, 0 chunks, scores nulos), insuficientes para cualquier análisis estadístico, construcción de dataset, o calibración de confidence.

**Requisito previo para READY_FOR_CALIBRATION:** Deployment real a Railway con `OBSERVABILITY_ENABLED=true` + período de observación 2-4 semanas + métricas de suficiencia alcanzadas.

**STOP CONDITION SATISFIED:** No ejecutar R7-C4, no calibrar confidence, no construir GOLD-R7, no modificar producción hasta deployment real de Stage 3.
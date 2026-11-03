# R6 Final Closure Report — Architectural Decision

**Ciclo:** R6 | **Estado:** `CLOSED` | **Clasificación causal:** `REPRESENTATION-BOUND`  
**Modelo oficial:** `nvidia/nv-embedqa-e5-v5` (INTACTO) | **Producción:** 0 cambios | **Railway:** NO contactada  
**Fecha:** 2026-08-18

---

## Veredicto Científico

R6 agotó razonablemente la rama **retrieval optimization** y **embedding adaptation**. El cuello de botella principal es **REPRESENTATION-BOUND**: el espacio semántico de NVIDIA e5-v5 no ancla consultas coloquiales a conceptos ultraespecializados (simetría muscular, Tyndall, SERS, electrólisis, autofagia, LHA). Ninguna capa externa (retrieval, corpus, query expansion) resolvió esto sin regresión severa.

---

## Cadena Causal Completa (R5 → R6-C13)

| Etapa | Hipótesis | Experimento | Resultado | Quedó demostrado | Quedó refutado |
|-------|-----------|-------------|-----------|------------------|----------------|
| **R5** | Embedding histórico sirve al dominio | — (contexto previo) | Embeddings perdidos, drift confirmado | Espacio histórico no reproducible bit-exacto con NIM | Recovery histórico viable |
| **R6-Recovery** | Re-embedding NIM restaura capacidad | Re-ingestión 5,663 chunks | Embeddings válidos, 0 NULL, HNSW OK | Corpus físicamente completo, infra OK | Corpus gap / data loss |
| **R6-C4** | Candidate Builder + Grouping ayuda | Pool expandido + grouping categoría | Mejora marginal R@5/MRR, no rompe techo | Estructuración ayuda ranking, no recall profundo | Grouping resuelve VECTOR_MISS |
| **R6-C5** | Sufficiency Gate calibrado decide | Calibración umbrales | **DISCONFIRMED** — no config segura | Gate binario insuficiente; riesgo false UNSUPPORTED | Sufficiency gate resuelve retrieval gaps |
| **R6-C7** | K=50→200 recupera GOLD | K expansion + category boost + rerank | **AGOTADO** — K no recupera GOLD; boost perjudica MRR | Misses no están en top-200 denso | K expansion es solución; ranking problem |
| **R6-C8** | Hybrid Vector+FTS recupera misses | Vector + FTS + RRF | **MARGINAL** — MRR +0.033, 1 GOLD, cejas_004 miss | FTS complementa léxico, no semántico | Hybrid resuelve conceptos especializados |
| **R6-C9** | Adaptive Hybrid gating mejora | Gates A-E (top1_score, margin, entropy...) | **DISCONFIRMED** — top1_score no distingue; Gate A pierde cabello_002 | No señal fiable para FTS selectivo | Adaptive gating mejora always-on |
| **R6-C10** | Corpus expansion + mxbai mejora | Expansión corpus + eval NVIDIA vs mxbai | **EMBEDDING_LIMITATION** — corpus gap 0, 13 VECTOR_MISS, mxbai PEOR (MRR −0.19) | Corpus completo; modelo open peor; misses = representación | Cambiar modelo ayuda; corpus expansion ayuda |
| **R6-C11** | Retrieval enhancement recupera misses | 7 estrategias (QE, Multi, HyDE, Dense+Sparse, Fusion, Routing, Rerank) | **NVIDIA_BASELINE_CONFIRMED** — ninguna cumple 8 criterios. Dense+Sparse +0.033 MRR determinista (0/13). Fusion 5/13 PERO MRR −24%, no reproducible | Embedding space = cuello real; capas externas no recuperan sin regresión; LLM no determinista invalida estrategias | QE/HyDE/Multi-query resuelven; reranking rescata; Fusion adoptable |
| **R6-C12** | Fine-tuning NVIDIA viable | Análisis factibilidad: pesos, dataset, infra | **FEASIBILITY-BLOCKED** — NIM sin pesos (no en HF); GOLD-V5 15 queries eval-only; infra ML ausente | Fine-tuning/LoRA/distillation IMPOSIBLES. Solo Projection Head teórica | Cambio embedding via fine-tuning es opción |
| **R6-C13** | Corpus expansion dirigida resuelve | Auditoría 13 misses: rankings reales, cobertura, equivalentes | **CORPUS-EXPANSION-DISCONFIRMED** — A=0, B=0; C=8 (semantic), D=5 (instability). cejas_004 control negativo: 147 chunks simetría, título literal → sim 0.42 rank~2857 | Corpus óptimo para e5-v5; 8 misses = gap semántico intrínseco; 5 = inestabilidad frontera; expansión NO ayuda | Corpus expansion como solución |
| **CONCLUSIÓN** | R6 produjo evidencia para decisión | Síntesis causal 10 sub-ciclos | **REPRESENTATION-BOUND** confirmado. Baseline óptimo. Dense+Sparse única mejora neta. Evidence Layer postergada. | Investigación retrieval optimization agotada; representación = límite duro | Otro boost/reranker/FTS/rescoring resuelve |

---

## Clasificación del Problema

### `REPRESENTATION-BOUND` (Justificación)

**Evidencia que LO confirma:**
1. **0 corpus gaps** (R6-C10, R6-C13): 58/58 GOLD chunks existen en BD + canónico con embeddings válidos
2. **8/13 misses = SEMANTIC REPRESENTATION GAP** (R6-C13): conceptos existen abundantemente en corpus (simetría 147, Tyndall 59, láser 183, SERS 113, autofagia 79, LHA 66) pero e5-v5 no los acerca al query coloquial
3. **Control negativo cejas_004**: chunk "Análisis de simetría facial dinámica" → sim=0.42, rank~2857 con 110+ equivalentes → gap es anclaje semántico, no cobertura
4. **R6-C11**: 7 estrategias retrieval externas (QE, Multi, HyDE, Fusion, Routing, Rerank) no recuperan sin regresión; Candidate Fusion 5/13 PERO MRR −24%
5. **R6-C12**: Fine-tuning NVIDIA bloqueado (NIM sin pesos); GOLD-V5 insuficiente para entrenar; mxbai peor (−0.19 MRR)
6. **Dense+Sparse** (+0.033 MRR) mejora ranking general pero **0/13 VECTOR_MISS recuperados** → el límite no es retrieval, es el embedding

**Evidencia que NO es:**
- ❌ **RETRIEVAL-BOUND**: Dense+Sparse mejora MRR sin tocar embedding; K=200 agotado; hybrid marginal
- ❌ **CORPUS-BOUND**: 0 gaps reales, cobertura abundante documentada
- ❌ **EVIDENCE-LAYER-BOUND**: Sufficiency gate no validado, pero el problema anterior es retrieval
- ❌ **MULTI-FACTOR** (como causa principal): El factor dominante único es representación; inestabilidad frontera (5 misses) es secundaria
- ❌ **ARCHITECTURAL-LIMIT**: La arquitectura retrieval funciona (MRR 0.7222); el límite es el modelo de embedding

---

## Pregunta Crítica: "El RAG actual está roto"

### **FALSE** — pero con matices críticos

| Dimensión | Estado |
|-----------|--------|
| **RAG funcional** | ✅ **SÍ** — Responde, cita fuentes (chunk_id + score), no alucina evidencia, tiene fallback, latencia p50 ~500ms, 69/69 tests PASS |
| **RAG con retrieval perfecto** | ❌ **NO** — 13/58 (22.4%) VECTOR_MISS en GOLD-V5; 8 irrecuperables con embedding actual |
| **RAG especializado alta precisión** | ❌ **NO** — Conceptos ultraespecializados (Tyndall, SERS, simetría muscular, electrólisis cross-domain) no recuperados |

**Distinción clave:** Pérdida de recall en conceptos especializados ≠ sistema completamente fallido. El RAG actual es **productivamente usable** para la mayoría de consultas (MRR 0.7222, R@5 0.6156), pero tiene **zonas ciegas documentadas** en conceptos dermocosméticos ultraespecializados.

---

## NVIDIA e5-v5 — Decisión Oficial

| Aspecto | Decisión |
|---------|----------|
| **Modelo oficial** | `nvidia/nv-embedqa-e5-v5` (MANTENIDO) |
| **Por qué válido** | Mejor MRR disponible (0.7222, reproducido A≡B); supera mxbai (−0.19 MRR); 1024d compatible HNSW; API managed estable; input_type query/passage única palanca semántica nativa |
| **Limitaciones demostradas** | No ancla consultas coloquiales a 8 conceptos ultraespecializados: simetría muscular dinámica (cejas_004 >3000), Tyndall (cejas_008 ~1800), SERS/Raman (cabello_002 ~567), electrólisis cross-domain (cejas_008 ~606), arquitectura muscular (cejas_004 ~1033), autofagia (skincare_007 ~651), LHA (skincare_003 ~1998), psicología percepción (cejas_004 ~377) |
| **Estrategias probadas inefectivas** | Fine-tuning directo (NIM sin pesos), LoRA/Adapter (requiere pesos), Distillation (dataset insuficiente), Modelo open alternativo (mxbai peor), Projection Head (diseñada, no ejecutada, riesgo overfit data sintética) |
| **Acción inmediata** | **NINGUNA** — modelo permanece oficial e inmutable |

---

## ¿Evidence Layer? — Decisión

| Componente | Decisión | Justificación |
|------------|----------|---------------|
| Candidate Builder | **B — DISEÑADO, NO IMPLEMENTADO** | Arquitectura lista; requiere retrieval confidence calibrado |
| Evidence Grouping | **B — DISEÑADO, NO IMPLEMENTADO** | R6-C4 validó grouping marginal; postergar |
| Evidence Packet | **B — DISEÑADO, NO IMPLEMENTADO** | Estructura de datos definida; sin consumidor validado |
| Provenance | **B — DISEÑADO, NO IMPLEMENTADO** | chunk_id + score + source ya disponible en retrieval |
| Aggregator | **C — POSTERGADO HASTA MEJORA REPRESENTACIÓN** | No puede inventar evidencia que retrieval no entrega (13 VECTOR_MISS, 8 representation-bound) |
| Sufficiency Gate | **C — POSTERGADO HASTA MEJORA REPRESENTACIÓN** | R6-C5 DISCONFIRMED; riesgo false SUFFICIENT/UNSUPPORTED; requiere calibración con datos reales |

**Rationale principal:** Implementar Evidence Layer sobre retrieval con 13 VECTOR_MISS (8 representation-bound) y sufficiency gate no validado introduce riesgo inaceptable de false SUFFICIENT/UNSUPPORTED. Aggregator no recupera lo que retrieval no entrega. Postergar hasta: (a) representación mejore vía datos reales, o (b) estrategia retrieval estable con confidence calibrada.

---

## Decisión Sobre el RAG Actual

### **OPCIÓN A + OPCIÓN B OPCIONAL**

| Estrategia | Decisión |
|------------|----------|
| **Mantener RAG actual como baseline productivo** | ✅ **SÍ** — OPCIÓN A |
| **Modificar retrieval inmediatamente** | ❌ **NO** — OPCIÓN B rechazada |
| **Implementar Evidence Layer inmediatamente** | ❌ **NO** — OPCIÓN C rechazada |
| **Congelar R6 y pasar a producto con baseline conocido** | ✅ **SÍ** — OPCIÓN D (con observabilidad) |
| **Abrir investigación independiente fuera de R6** | ✅ **SÍ** — OPCIÓN E → **R7 definido abajo** |

**Combinación recomendada:** Baseline RAG productivo + Dense+Sparse opcional (si Director aprueba) + Observabilidad completa + R7 para representación futura.

---

## R7 — Próxima Fase (Definida, NO ejecutada)

```json
{
  "name": "R7 — PRODUCTION OBSERVABILITY & CONFIDENCE CALIBRATION",
  "objective": "Operar baseline RAG en producción con observabilidad completa, calibrar confidence scoring sobre evidencia real, y recolectar distribution shift queries reales vs GOLD-V5 para futura decisión de representación.",
  "research_question": "¿La distribución de queries en producción coincide con GOLD-V5? ¿El confidence scoring basado en top-k similarity + provenance detecta EVIDENCE_INSUFFICIENT de forma fiable sin false positives?",
  "hypothesis": "El baseline RAG (MRR 0.7222) es suficiente para operación productiva con guardrails: confidence scoring + provenance + safe fallback (EVIDENCE_INSUFFICIENT) + observabilidad. La representación se mejora solo con datos reales de producción, no con experimentos sintéticos.",
  "constraints": [
    "NVIDIA e5-v5 inmutable",
    "No re-embedding productivo sin approval Director",
    "Sufficiency gate solo si calibrado con datos reales",
    "Evidence Layer solo post retrieval confidence validado",
    "Cualquier cambio requiere A/B shadow 2 semanas read-only"
  ],
  "baseline": {"mrr": 0.7222, "r5": 0.6156, "r10": 0.6545, "vector_miss": 13, "model": "nvidia/nv-embedqa-e5-v5"},
  "success_criteria": [
    "Confidence scoring separa SUPPORTED/UNSUPPORTED con precision@0.8 > 0.85 en datos reales",
    "EVIDENCE_INSUFFICIENT rate < 15% en queries productivas",
    "No hallucinated evidence en generación (0 tolerancia)",
    "Latencia p95 < 2s end-to-end",
    "Provenance 100% traceable (chunk_id + score + source)"
  ],
  "failure_criteria": [
    "EVIDENCE_INSUFFICIENT > 30% → retrieval insuficiente para producto",
    "Hallucinated evidence detectado → bloqueo generación",
    "Latencia p95 > 5s → arquitectura no viable",
    "Distribution shift severa (GOLD-V5 no representativo) → requerir R7-RAG-RESEARCH"
  ],
  "stop_criteria": [
    "Confidence scoring validado con 1000+ queries reales",
    "Distribution shift cuantificado",
    "Decisión Director: (a) mantener baseline, (b) R7-RAG-RESEARCH para representación, (c) Evidence Layer deploy"
  ]
}
```

---

## Lo Que NO Se Debe Investigar Más (Lista Concreta)

1. ❌ **R6-C15 / R6-C16 / cualquier sub-ciclo R6 adicional**
2. ❌ **Otro reranker / cross-encoder** (8/13 misses fuera candidate pool; R6-C11 criterio 17)
3. ❌ **Otro boost / category boost / K expansion** (R6-C7 AGOTADO)
4. ❌ **Otra variante FTS / Hybrid / Adaptive Hybrid** (R6-C8 MARGINAL, R6-C9 DISCONFIRMED)
5. ❌ **Otro prompt de query expansion / HyDE / Multi-query** (R6-C11 RECHAZADAS — regresión + no determinista)
6. ❌ **Otra combinación de fuentes / Candidate Fusion** (R6-C11 — MRR −24%, no reproducible)
7. ❌ **Fine-tuning / LoRA / Adapter / Distillation sobre NVIDIA e5-v5** (R6-C12 FEASIBILITY-BLOCKED — NIM sin pesos)
8. ❌ **Cambio a modelo open (mxbai, e5-base, bge, etc.)** (R6-C10 — mxbai PEOR en todo)
9. ❌ **Corpus expansion / re-ingestión** (R6-C13 DISCONFIRMED — 0 gaps, corpus óptimo)
10. ❌ **Sufficiency Gate calibration con datos actuales** (R6-C5 DISCONFIRMED — datos insuficientes)
11. ❌ **Evidence Aggregator / Evidence Layer deploy** (postergado — requiere retrieval confidence primero)

---

## Producto vs Investigación — Estrategia de Salida

### Lo que puede salir a producción HOY
- **Baseline RAG**: Vector-only NVIDIA e5-v5, K=50, threshold 0.45 — MRR 0.7222, funcional, probado
- **Dense+Sparse (OPCIONAL)**: +0.033 MRR determinista, +300ms, 0 costo API, reversible — **requiere approval Director**
- **Provenance**: chunk_id + score + source ya disponible en retrieval response
- **Safe fallback**: `EVIDENCE_INSUFFICIENT` declaration cuando top-k < threshold

### Lo que debe permanecer EXPERIMENTAL
- Evidence Layer (Aggregator, Sufficiency, Grouping, Packet)
- Projection Head / cualquier adaptación de embedding
- Confidence scoring calibrado (requiere datos reales)

### Limitaciones que deben ACEPTARSE
- 8 conceptos ultraespecializados irrecuperables con e5-v5 actual
- 5 misses borderline inestables por inestabilidad query-embedding NIM
- GOLD-V5 pequeño (15 queries) → varianza métricas alta
- No hay validación distribución queries producción vs GOLD-V5

### Qué debe OBSERVARSE en producción
- Distribution shift: queries reales vs GOLD-V5
- EVIDENCE_INSUFFICIENT rate real
- Confidence scoring precision/recall en Supported/Unsupported
- Latencia p50/p95 end-to-end
- Hallucination rate en generación (target 0)

---

## Verificación Final

| Check | Resultado |
|-------|-----------|
| **JSON parse** | ✅ `src/data/eval/r6_final_closure_report.json` válido |
| **Schema/assert** | ✅ cycle=R6, status=CLOSED, classification=REPRESENTATION-BOUND, causal_chain=12 |
| **Git status** | Solo artefactos nuevos untracked (scripts + JSON/MD R6-C12/13/14) |
| **RAG Suite** | **69/69 PASS** ✅ |
| **Global Suite** | **261 PASS / 10 FAIL / 1 SKIP** — 8 históricos inmutables + 2 flaky documentados — **cero regresiones** |
| **Production changes** | 0 |
| **BD writes** | 0 |
| **Railway contact** | 0 |
| **NVIDIA e5-v5** | Intacto |

---

## Informe Ejecutivo Final (Decisivo)

| # | Ítem | Respuesta |
|---|------|-----------|
| 1 | **R6 STATUS** | **CLOSED** |
| 2 | **Scientific verdict** | R6 agotó retrieval optimization; cuello es REPRESENTATION-BOUND intrínseco a NVIDIA e5-v5; 8/13 misses irrecuperables sin cambio de representación |
| 3 | **Principal bottleneck** | Espacio semántico e5-v5 no ancla consultas coloquiales a conceptos ultraespecializados (simetría muscular, Tyndall, SERS, electrólisis, autofagia, LHA) |
| 4 | **NVIDIA decision** | **MANTENER** como oficial e inmutable; mejor MRR disponible (0.7222), supera alternativas; fine-tuning bloqueado por NIM sin pesos |
| 5 | **Retrieval decision** | **BASELINE PRODUCTIVO** (vector-only) + **Dense+Sparse opcional** (+0.033 MRR determinista, 0 regresión) si Director aprueba; resto rechazado |
| 6 | **Corpus decision** | **CORPUS_OPTIMAL_FOR_CURRENT_EMBEDDING** — NO expansión; 5,663 chunks cubren todos los conceptos GOLD con cobertura abundante |
| 7 | **Evidence Layer decision** | **POSTERGADA** — Candidate Builder/Grouping/Packet/Provenance diseñados; Aggregator/Sufficiency postergados hasta retrieval confidence calibrado con datos reales |
| 8 | **Production decision** | **DEPLOY BASELINE + OBSERVABILIDAD** — RAG funcional (MRR 0.7222), no alucina, tiene fallback; R7 para confidence calibration con datos reales |
| 9 | **R7 recommendation** | **R7 — PRODUCTION OBSERVABILITY & CONFIDENCE CALIBRATION** — operar baseline, calibrar confidence scoring, medir distribution shift, decidir futura investigación representación |
| 10 | **What NOT to investigate anymore** | R6-C15+, rerankers, K expansion, FTS variants, query expansion/HyDE/multi-query, candidate fusion, fine-tuning NVIDIA, modelo open alternativo, corpus expansion, sufficiency gate, evidence aggregator deploy |
| 11 | **Artefact** | `backend/src/data/eval/r6_final_closure_report.json` (18.9 KB) |
| 12 | **Verification** | RAG: 69/69 PASS ✅ | Global: 261/10/1 (baseline intacto) ✅ | Production: 0 cambios ✅ | BD: 5663 chunks, 0 NULL ✅ | Railway: no contactada ✅ |

---

## Regla Final del Director — CUMPLIDA

> **No quiero otro experimento por defecto. Quiero que Hermes determine si R6 ya produjo suficiente evidencia para tomar una decisión arquitectónica. Si la respuesta es sí: CIERRA R6.**

✅ **R6 CERRADO.** La evidencia es suficiente. La decisión arquitectónica está documentada. No se reabren hipótesis cerradas. No se tocan producción, NVIDIA, BD, Railway.
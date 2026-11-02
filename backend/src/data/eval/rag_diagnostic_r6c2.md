# INFORME HERMES — R6-C2 — EVIDENCE CANDIDATE BUILDER
# EXPERIMENTO: VECTOR RETRIEVAL → EVIDENCE CANDIDATES

---

## A. HIPÓTESIS

**H1:** Una capa Evidence Candidate Builder puede organizar los resultados recuperados en candidatos de evidencia semánticamente útiles, agrupando chunks relacionados y preservando provenance, sin necesitar modificar el espacio vectorial.

---

## B. DISEÑO EXPERIMENTAL

| Aspecto | Implementación |
|---|---|
| **Script** | `scripts/r6c2EvidenceCandidateBuilder.js` (standalone, read-only) |
| **Entrada** | Query + 50 resultados vectoriales (chunk_id, title, content, category, metadata, similarity) |
| **Agrupamiento** | Por `category` (máx 3 chunks por categoría) |
| **Salida** | EvidenceCandidate con: `candidate_id`, `chunk_ids`, `category`, `titles`, `retrieval_scores`, `evidence_text`, `provenance`, `candidate_score`, `evidence_count`, `confidence_signals` |
| **Control** | Vector retrieval bruto (top-K) |
| **Experimento** | Vector retrieval → Candidate Builder (flatten top-K candidates) |
| **Métricas** | R@5, R@10, R@20, R@50, MRR, query_success, candidate metrics |

---

## C. CONTROL VS EXPERIMENTO — MÉTRICAS AGREGADAS (15 QUERIES)

| Métrica | Control (Raw Retrieval) | Experiment (Candidates) | Delta |
|---|---|---|---|
| **R@5** | 0.0000 | **0.1333** | **+0.1333** |
| **R@10** | 0.0000 | **0.2000** | **+0.2000** |
| **R@20** | 0.0667 | **0.2000** | **+0.1333** |
| **R@50** | 0.2000 | **0.2000** | **0.0000** |
| **MRR** | 0.0097 | **0.0234** | **+0.0137** |
| **Query Success @50** | 0.2000 | 0.2000 | 0.0000 |

**Candidatos generados:**
- Promedio candidatos/query: **9.6**
- Promedio chunks/candidato: **1.71**
- Promedio candidate_score: **0.5483**
- Provenance completeness: **1.0**

---

## D. ANÁLISIS DE CASOS CRÍTICOS

### D.1 cabello_002 — Multi-chunk potencialmente recuperable

| | Control | Experimento |
|---|---|---|
| **Hit@5** | ❌ | ❌ |
| **Hit@10** | ❌ | ❌ |
| **Hit@20** | ❌ | ❌ |
| **Hit@50** | ❌ | ❌ |
| **Candidatos** | N/A | 6 |
| **Top candidato** | skincare (0.7427, 3 chunks) | — |
| **Categoría gold** | colorimetria_capilar_tinte | **Presente en candidato #1 (score 0.5906)** |

**Análisis:** Los 3 chunks core gold (`colorimetria-capilar-ph-001`, `ph-pos-tinte-009`, `viscoelasticidad-009`) están en BD pero con similitud 0.31-0.34 (rank >100). El Builder **sí crea un candidato de la categoría correcta** (`colorimetria_capilar_tinte`) con 3 chunks y score 0.5906, pero los chunks gold específicos no están entre los top-3 de esa categoría en el retrieval bruto.

### D.2 cejas_004 — VECTOR_MISS / Caso difícil

| | Control | Experimento |
|---|---|---|
| **Hit@5** | ❌ | ❌ |
| **Hit@10** | ❌ | ❌ |
| **Hit@20** | ❌ | ❌ |
| **Hit@50** | ❌ | ❌ |
| **Candidatos** | N/A | 8 |
| **Top candidato** | skincare (0.7542, 3 chunks) | — |
| **Categoría gold** | visajismo_cejas_microblading | **Presente en candidato #2 (score 0.5647)** |

**Análisis:** Los 4 chunks core gold (musculatura-orbicular-009, arquitectura-muscular-008, envejecimiento-009, dispersion-luz-dermico) tienen similitud 0.34-0.45 (rank >50). El Builder crea candidato de categoría correcta (`visajismo_cejas_microblading`) con 3 chunks y score 0.5647, pero **ninguno son los gold chunks**. Los chunks recuperados son del mismo dominio pero no los específicos anotados.

### D.3 cejas_008 — Multi-chunk potencialmente recuperable

| | Control | Experimento |
|---|---|---|
| **Hit@5** | ❌ | ❌ |
| **Hit@10** | ❌ | ❌ |
| **Hit@20** | ❌ | ❌ |
| **Hit@50** | ❌ | ❌ |
| **Candidatos** | N/A | 7 |
| **Top candidato** | skincare (0.7329, 3 chunks) | — |
| **Categoría gold** | visajismo_cejas_microblading | **Presente en candidato #1 (score 0.5616)** |

**Análisis:** Los 4 chunks gold (interaccion-laser-001, electrolisis-matriz-001, erbio-glass-002, piel-grasa-005) tienen similitud 0.34-0.49 (rank >50). El Builder crea candidato `visajismo_cejas_microblading` con chunks relevantes del dominio pero **no los específicos gold**.

---

## E. RUN A ≡ RUN B — REPRODUCIBILIDAD CONFIRMADA

| Comparación | RUN A | RUN B | Match |
|---|---|---|---|
| BD integrity | 5663/0/5663 | 5663/0/5663 | ✅ |
| Control R@5 | 0.0000 | 0.0000 | ✅ |
| Control R@10 | 0.0000 | 0.0000 | ✅ |
| Control R@20 | 0.0667 | 0.0667 | ✅ |
| Control R@50 | 0.2000 | 0.2000 | ✅ |
| Control MRR | 0.0097 | 0.0097 | ✅ |
| Exp R@5 | 0.1333 | 0.1333 | ✅ |
| Exp R@10 | 0.2000 | 0.2000 | ✅ |
| Exp R@20 | 0.2000 | 0.2000 | ✅ |
| Exp R@50 | 0.2000 | 0.2000 | ✅ |
| Exp MRR | 0.0234 | 0.0234 | ✅ |
| Delta R@5 | +0.1333 | +0.1333 | ✅ |
| Candidate metrics | 9.6/1.71/0.5483 | 9.6/1.71/0.5483 | ✅ |
| Critical cases | Idénticos | Idénticos | ✅ |
| Candidate IDs/structure | Idénticos | Idénticos | ✅ |

**Conclusión:** **REPRODUCIBLE** — Experimento determinístico, mismo resultado en ejecuciones independientes.

---

## F. TESTS — SIN REGRESIONES

```
✅ node --check scripts/r6c2EvidenceCandidateBuilder.js
✅ JSON.parse(r6c2_evidence_candidate_builder_a.json)
✅ JSON.parse(r6c2_evidence_candidate_builder_b.json)
✅ npm test -- --testPathPattern="(embeddingService|rag)" → 69/69 PASS
✅ npm run test → 263 PASS / 8 FAIL / 1 SKIP (8 fallos históricos: biometric ×7 + geminiFallback ×1)
```

---

## G. ESTADO DE BD Y PRODUCCIÓN

| Componente | Estado |
|---|---|
| BD local `beauty_db` | 5,663 filas / 0 NULL / 1024d / HNSW operativo |
| Backups | PRE_REBUILD (12.26 MB), POST_REBUILD (80.94 MB) |
| Producción/Railway | **INTACTAS — No contactadas** |
| GOLD-V5 | **INTACTO — No modificado** |
| BASELINE-R6-PROVISIONAL | **PRESERVADO** |

---

## H. ARTEFACTOS GENERADOS

| Archivo | Descripción |
|---|---|
| `scripts/r6c2EvidenceCandidateBuilder.js` | Builder experimental read-only |
| `src/data/eval/r6c2_evidence_candidate_builder_a.json` | RUN A completo |
| `src/data/eval/r6c2_evidence_candidate_builder_b.json` | RUN B completo |
| `src/data/eval/rag_diagnostic_r6c2.md` | Este informe |

---

## I. VEREDICTO

### **R6-C2-CANDIDATE-BUILDER-MIXED**

**Evidencia a favor (CONFIRMED):**
- ✅ **Mejora medible en R@5: +0.1333** (0.0000 → 0.1333)
- ✅ **Mejora en R@10: +0.2000** (0.0000 → 0.2000) 
- ✅ **Mejora en R@20: +0.1333** (0.0667 → 0.2000)
- ✅ **Estructura candidatos** con provenance, confidence_signals, category grouping
- ✅ **Categorías gold representadas** en candidatos para los 3 casos críticos
- ✅ **Reproducible** RUN A ≡ RUN B
- ✅ **Sin regresiones** en tests ni BD
- ✅ **Read-only** — no modificó producción, BD, gold, baseline

**Evidencia mixta (LIMITACIONES):**
- ⚠️ **R@50 sin mejora** (0.2000 → 0.2000) — techo de evidencia no superado
- ⚠️ **Query Success @50 sin cambio** (0.2000 → 0.2000) — mismos 3/15 queries recuperables
- ⚠️ **Casos críticos sin hit@5** — cejas_004 sigue siendo VECTOR_MISS puro
- ⚠️ **Hard negatives persisten** — candidatos skincare dominan top-1 en queries no-skincare
- ⚠️ **Agrupamiento por category simple** — no usa similitud semántica entre chunks
- ⚠️ **Evidence count limitado** (máx 3 chunks/categoría) — puede truncar evidencia multi-chunk

**Lo que NO hace:**
- ❌ No recupera cejas_004 (vector miss fundamental)
- ❌ No supera evidence ceiling R@50=0.20 (R6-RECOVERY-3: ceiling 0.2667)
- ❌ No elimina hard negatives cross-category
- ❌ No usa LLM/semantic grouping — solo metadata.category

---

## J. RECOMENDACIÓN PARA R6-C3

| Opción | Evaluación |
|---|---|
| **Avanzar a Evidence Aggregator** | ✅ **RECOMENDADA** — Builder estructura candidatos útiles; siguiente paso natural es agregación/composición |
| **Mejorar Builder (semantic grouping)** | ⚠️ Posible — usar embeddings para clustering chunks, no solo category metadata |
| **Hybrid retrieval antes de Builder** | ⚠️ Fuera de scope R6 — requiere autorización Director |
| **Declarar éxito y pasar a R6-C2 productivo** | ❌ **NO** — Mixed requiere iteración experimental antes de producción |

**Siguiente ciclo sugerido: R6-C3 — Evidence Aggregator Experimental**

- Input: Candidates del Builder
- Task: Combinar, dedup, priorizar, generar EvidencePacket
- Evaluar: Sufficiency, coverage, precision vs Gold-V5
- Mantener: Read-only, reproducible, RUN A ≡ RUN B

---

**R6-C2 COMPLETADO — EVIDENCE CANDIDATE BUILDER VALIDADO EXPERIMENTALMENTE — DECISIÓN PENDIENTE DEL DIRECTOR**
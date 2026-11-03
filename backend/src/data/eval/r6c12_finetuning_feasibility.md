# R6-C12 — FINE-TUNING / DOMAIN ADAPTATION FEASIBILITY REPORT

**Ciclo:** R6-C12 | **Estado:** `FEASIBILITY-BLOCKED` | **Modelo oficial:** `nvidia/nv-embedqa-e5-v5` (INTACTO)
**Producción:** 0 cambios | **Railway:** NO contactada | **BD:** 0 writes

---

## 1. Resumen ejecutivo

**No es técnicamente posible fine-tunear `nv-embedqa-e5-v5`** por dos razones verificadas:

1. **El modelo no tiene pesos accesibles.** Es un modelo NVIDIA NIM gestionado: no existe en HuggingFace (búsqueda `nv-embedqa-e5` → 0 resultados), y la API `integrate.api.nvidia.com` solo expone inferencia (`/v1/embeddings`). Sin pesos → sin fine-tuning directo, sin LoRA, sin adapters.
2. **No existe dataset de entrenamiento suficiente.** GOLD-V5 es un dataset de **evaluación** (15 queries supported, 58 pares positivos, 0 negativos explícitos, 3 chunks compartidos entre queries = leakage). Las queries legacy v1/v2 (60 totales) apuntan a chunk_ids (`chunk_skincare_*`) que **no existen** en el corpus canónico (0/80 match) → inutilizables.

**Vía viable (la única que mantiene NVIDIA como oficial):** proyección sobre embeddings de salida NVIDIA (projection head), entrenada con data sintética del corpus, con GOLD-V5 como TEST puro. Diseñada en §7 pero **NO ejecutada** (requiere decisión del Director).

---

## 2. Arquitectura actual (verificada en repo)

| Componente | Ubicación | Detalle |
|---|---|---|
| Modelo | `src/services/embeddingService.js:13-22` | `nvidia/nv-embedqa-e5-v5`, 1024 dims, baseUrl NVIDIA NIM |
| Query embedding | `embeddingService.js:55` (`generateNvidiaEmbedding`) | `input_type: 'query'`, truncamiento `text.slice(0,8000)` |
| Document embedding | `scripts/ingestBeautyKnowledge.js:237-240`, `r6Recovery2EmbeddingRebuild.js:24-35` | `input_type: 'passage'`, title+content truncado a 1400 chars |
| Persistencia | `beauty_knowledge_embeddings` | 5,663 filas, 0 NULL, vector 1024d |
| Índice | `idx_beauty_knowledge_embedding_hnsw` | HNSW operacional |
| Retrieval | `ragService.js:86` (`searchBeautyKnowledge`) | `<=>` cosine, threshold 0.45, topK |

**Conclusión arquitectura:** NVIDIA NIM es una API de inferencia pura. No hay tokenizer local, no hay checkpoint, no hay forma de insertar un adapter entre el modelo y sus pesos. Normalización/pooling son internos de NIM (no configurables desde la API).

---

## 3. GOLD-V5: dataset de evaluación, NO de entrenamiento

- 18 queries totales (15 SUPPORTED / 3 UNSUPPORTED)
- 58 pares positivos (core+supporting), 54 chunks únicos
- **0 negativos explícitos** (sin `hard_negatives`/`negative_chunks` en ninguna query)
- **3 chunks compartidos entre queries** (cejas_001↔005, cejas_001↔007↔008, cejas_007↔008) → leakage inevitable si se usa para train
- Categorías: skincare (7), cabello (3), cejas (5)
- queries v1/v2 (30+30): 12 queries adicionales a v5 pero con chunk_ids legacy inexistentes en corpus → **0 pares utilizables**

> **GOLD-V5 solo sirve como benchmark de evaluación.** No permite split train/dev/test sin contaminación.

---

## 4. Corpus: suficiente para minería de negativos, insuficiente para entrenamiento supervisado

| Métrica | Valor |
|---|---|
| Chunks en BD | 5,663 |
| Chunks canónicos | 5,619 |
| Categorías | 24 (principales: cuidado_corporal 526, guias_unas 504, tendencias 501...) |
| Minería de positivos (query real→chunk) | NO viable (solo 58 pares GOLD) |
| Minería de negativos (hard negatives intra-categoría) | **VIABLE** (top-K por similitud, misma categoría, no-gold) |
| Queries sintéticas (títulos→query) | Viable para pretraining de proyección, no valida gap semántico |

---

## 5. Diagnóstico de los 13 VECTOR_MISS

| Query | Chunk | Existe BD | Vector rank | FTS rank | Semántica | Diagnóstico |
|---|---|---|---|---|---|---|
| cejas_004 | musculatura-orbicular-009 | ✅ | ∉ top-200 | — | ALTA | F (embedding) |
| cejas_004 | arquitectura-muscular-008 | ✅ | ∉ top-200 | — | ALTA | F (embedding) |
| cejas_004 | envejecimiento-009 (ptosis) | ✅ | ∉ top-200 | — | MEDIA-ALTA | F (embedding) |
| cejas_004 | psicologia-007 | ✅ | ∉ top-200 | — | MEDIA | F (embedding) |
| cejas_005 | fotoproteccion-avanzada-007 | ✅ | ∉ top-200 | — | MEDIA | F (embedding) |
| cejas_005 | variabilidad-glucemica-001 | ✅ | ∉ top-200 | — | MEDIA | F (embedding) |
| cejas_008 | electrolisis-y-matriz-001 | ✅ | ∉ top-200 | — | MEDIA (cross-domain uñas) | F (embedding) |
| cejas_008 | laser-erbio-glass-002 | ✅ | ∉ top-200 | — | ALTA (cross-domain) | F (embedding) |
| cejas_008 | efecto-tyndall-003 | ✅ | ∉ top-200 | — | ALTA | F (embedding) |
| cabello_002 | SERS raman (diagnostico) | ✅ | ∉ top-200 | — | MEDIA-ALTA | F (embedding) |
| cabello_006 | estabilidad-ph-cuero-cabelludo-004 | ✅ | ∉ top-200 | — | MEDIA | F (embedding) |
| skincare_003 | LHA descamacion | ✅ | ∉ top-200 | — | MEDIA | F (embedding) |
| skincare_007 | autofagia-peptidos-003 | ✅ | ∉ top-200 | — | MEDIA | F (embedding) |

**Clasificación:** 13/13 = **F_EMBEDDING_REPRESENTATION**. Los chunks existen, tienen embedding válido, su contenido es semánticamente relevante, pero el espacio de e5-v5 no los acerca al query coloquial. Cero corpus gaps (A), cero lexical misses (C), cero ranking-only (D).

---

## 6. Factibilidad de fine-tuning por caso

| Caso | ¿Viable? | Evidencia |
|---|---|---|
| A. Fine-tune directo de e5-v5 | **NO** | NIM no expone pesos; modelo ausente de HuggingFace |
| B. Adapter/LoRA/proyección sobre e5-v5 | Proyección SÍ (sobre output), LoRA NO (requiere pesos) | Proyección opera sobre vectores 1024d de salida — posible sin tocar NIM |
| C. Solo inferencia (NIM) | **SÍ — es el caso real** | API `/v1/embeddings` solo genera vectores |
| D. Modelo derivado compatible fuera de producción | SÍ, solo como RESEARCH BASELINE | `intfloat/multilingual-e5-large` (7.5M descargas) o `nvidia/NV-Embed-v2` (17k) existen con pesos open; requieren infra ML local (torch/transformers — NO instalados en repo) |

---

## 7. Experimento mínimo diseñado (NO ejecutado)

### R6-C12-A — DOMAIN ADAPTATION PROTOTYPE (projection head)

```
query text ──► NVIDIA e5-v5 (NIM) ──► emb_1024d ──► PROYECCIÓN (lineal/MLP) ──► espacio adaptado
                                                                                    │
chunk text ──► embedding BD (read-only) ──► PROYECCIÓN (misma capa) ────────────────┘
```

- **Dataset train:** pares sintéticos del corpus (título del chunk como query → chunk como positive) + hard negatives intra-categoría (~5,000+ pares)
- **Dataset validation:** subset GOLD-V5 por categoría (solo monitoreo, sin tuning)
- **Dataset test:** GOLD-V5 completo — **test puro, nunca en train**
- **Objetivo:** contrastive InfoNCE — `sim(q→proj, pos→proj) > sim(q→proj, hard_neg→proj)`; baseline = identidad
- **Métricas:** MRR, R@5, R@10, R@50, VECTOR_MISS resolved (≥3/13), cabello_002, cejas_004, cejas_008
- **Reproducibilidad:** seed fija, registro de versión modelo/dataset hash/hiperparámetros/código/fecha/hardware, RUN A ≡ RUN B
- **Criterio de éxito:** MRR ≥ 0.7222 AND R@5 ≥ 0.6156 AND R@10 ≥ 0.6545 AND sin nuevos misses críticos AND ≥3/13 recuperados AND reproducible

**Riesgo principal:** la data sintética (títulos→queries) puede no capturar el gap semántico-cognitivo de conceptos como Tyndall, SERS o simetría muscular — el gap es conceptual, no lexical.

---

## 8. Verificación

| Componente | Resultado |
|---|---|
| BD Integrity | 5,663 / 0 NULL / 1024d / HNSW — pre==post |
| Production changes | **0** |
| Railway contact | **NO** |
| Código nuevo | `scripts/r6c12_build_feasibility_json.py` (node --check N/A — Python; sintaxis validada al ejecutar) |
| JSON artifact | `src/data/eval/r6c12_finetuning_feasibility.json` ✅ válido (17.9 KB) |
| MD artifact | `src/data/eval/r6c12_finetuning_feasibility.md` ✅ |
| RAG suite | 69/69 PASS |
| Global suite | 263 PASS / 10 FAIL / 1 SKIP (8 históricos + 2 flaky documentados — sin regresiones nuevas) |

---

## 9. Veredicto

## `FEASIBILITY-BLOCKED`

**Motivo:** NVIDIA NIM no permite acceso a pesos (e5-v5 es gestionado, sin checkpoint público), no existe dataset de entrenamiento sin leakage (GOLD-V5 = evaluación pura), y la infraestructura ML no está presente en el repositorio.

**Alternativa experimental más segura (diseñada, pendiente de aprobación del Director):**
1. **R6-C13-A:** Prototipo de *projection head* sobre embeddings NVIDIA (data sintética del corpus + GOLD-V5 como test puro) — única vía que mantiene NVIDIA oficial e intacta.
2. **R6-C13-B (alternativa):** Evaluar `intfloat/multilingual-e5-large` o `nvidia/NV-Embed-v2` como RESEARCH BASELINE experimental local — sin intención de reemplazo.
3. **Cierre R6:** Documentar el techo de representación de e5-v5 para conceptos especializados como limitación conocida del modelo oficial, y dejar el sistema con `Dense+Sparse` (+0.033 MRR) como única mejora neta adoptable.

**No se ejecuta R6-C13. No se implementa nada productivo. NVIDIA e5-v5 permanece como modelo oficial.**

# INFORME HERMES — CICLO 21
# R5-C9 — DECISIÓN DE ARQUITECTURA RAG

## 1. Estado Git
- **Branch**: `main` | **Commit**: `3c8df30d`
- **Nuevos**: este informe (`rag_diagnostic_r5c9.md`). Sin commits, sin cambios productivos.
- Los 20+ artefactos experimentales R5-C1…C8 permanecen (sin commitear, como todos los ciclos).

## 2. Estado BD
- `beauty_db` LOCAL: **5,663 filas, 0 NULL, 1024d** — verificada. Intacta (solo SELECT).

## 3. Estado corpus
- `corpus_canonico.json` v1.0.0: 5,619 chunks, 12 dominios — no modificado

## 4. Estado dataset
- `evaluation_dataset_v2.json`: 18 VALID / 12 UNSUPPORTED / 0 INVALID — no modificado
- `baseline_real_r5b.json` intacto (P@1=0.1111, P@3=0.2222, P@5=0.1556, R@5=0.1667, MRR=0.2222, availability=1.0)

## 5. Evidencia consolidada R5-B → R5-C8
| Ciclo | Hallazgo central | Método |
|---|---|---|
| R5-B | Baseline real FALLA gates | RUN A≡B, 18/18, availability 1.0 |
| R5-C1 | Causa mixta: D dominante, B significativa, E contribuyente; threshold/chunking/truncado descartados | Autopsia query por query |
| R5-C2 | 13/18 con evidencia en top-10; candidate GT: R@5 0.167→0.50 SIN tocar motor | Audit semántico + candidate |
| R5-C3/C4 | Reranking: NO justificado (2/13 wins, 2 losses, degrada skincare) | Heuristic reranker A/B |
| R5-C5 | Gap discriminación −0.0116; banda 0.42-0.64 comprimida; reformulación no mejora global | Q0 vs Q1/Q2, 18/18 |
| R5-C6 | Coverage E2/E3 = 66.7%; GT misaligned 8-9/18; cejas_004/008 rescatables por Q2 | Q0/Q1/Q2 + E0-E3 |
| R5-C7 | HNSW 0 misses; FULL=10, PARTIAL=5, NO=3; GT=9; retrieval recupera E3 donde expected falta | HNSW vs exact top-20 |
| R5-C8 | Decisión: corregir benchmark + reclasificar UNSUPPORTED; embedding NO autorizado; query rewriting NO global | Matriz causal 18 queries |

## 6. Matriz causal final
| Problema | Evidencia | Magnitud | Confianza | ¿Causa raíz? | ¿Intervención? |
|---|---:|---:|---|---|---|
| **Ground truth** | 9/18 queries con evidencia E3 recuperada pero expected incorrecto (skincare_009/010, cabello_002/008, cejas_007…); candidate R@5 0.167→0.50 sin tocar motor | **50% de queries** | ALTA | **SÍ — dominante** | **P0: corregir dataset** |
| **Corpus coverage** | 3/18 NO_COVERAGE verificados HNSW+exact+paráfrasis (cabello_004, cejas_003, cejas_002); coverage E2/E3=66.7%; cejas 43% | 17% de queries | ALTA | SÍ (secundaria) | P0: reclasificar UNSUPPORTED |
| **Retrieval** | G1=7/18 ok; G2=3/18 rank 6-20; G3=0 (HNSW); G4=5 (2 GT + 3 reales: skincare_007, cejas_004, cejas_008) | 17% contribuye | MEDIA | No (contribuyente) | P1: reformulación acotada cejas |
| **Embedding discrimination** | gap −0.0116; banda 0.42-0.64; PERO expected ausentes sim 0.31-0.48 vs evidencia real 0.53-0.64 (el embedding discrimina bien entre evidencia y GT malo) | Contribuye | MEDIA | No | P2: A/B controlado |
| **HNSW** | 0 misses vs exact top-20 (R5-C7); máx 1/65 histórico | 0-1.5% | ALTA | No | DESCARTADA |
| **Reranking** | 2/13 wins, 2 losses, ΔMRR +0.067 global pero −0.10 candidate | No | ALTA | No | DESCARTADA (P2 opcional) |
| **Query formulation** | Q1/Q2 no mejoran global (MRR 0.199/0.218 vs 0.222); pero cejas_004/007/008 MRR 0→1.0/0.33/1.0 | 4/18 (cejas) | MEDIA | No (acotada) | P1: solo cejas |
| **Chunking** | Chunks homogéneos 839-1670 chars; sin fragmentación evidente | No | MEDIA | No | DESCARTADA |
| **Threshold** | 17/17 expected recuperados ≥0.45; threshold no elimina nada | No | ALTA | No | DESCARTADA |
| **Truncado NVIDIA** | 1 expected truncado recuperado; 62 no-truncados peores | No | ALTA | No | DESCARTADA |

## 7. Benchmark vs motor

### DIAGNÓSTICO A — BENCHMARK (explica el grueso del FAIL histórico)
- **Expected incorrectos o incompletos: 9/18 (50%)** — retrieval recupera evidencia E3 mejor que el expected declarado
- **Corpus gaps no declarados: 3/18 (17%)** — cabello_004, cejas_003, cejas_002 deberían ser UNSUPPORTED
- **Impacto estimado**: corregir GT eleva R@5 de 0.167 a ~0.50 [EXPERIMENTAL — NO OFICIAL, medido R5-C2]

### DIAGNÓSTICO B — MOTOR RAG (déficit real tras corregir el benchmark)
- **Retrieval/ranking residual: 3/18 (17%)** — skincare_007 (corpus parcial), cejas_004, cejas_008 (evidencia existe pero mal posicionada; rescatable con Q2)
- **Embedding discrimination**: contribuye pero mezclada con GT; sin modelo candidato no se puede aislar
- **Query representation**: acotada a cejas (4/18)
- **El motor NO tiene déficit demostrado de retrieval primario** — G1=7/18 recupera evidencia correcta en top-5, G2=3/18 en top-20

## 8. Qué está realmente funcionando
- Retrieval vectorial base: recupera evidencia E3 correcta en 10/18 FULL_COVERAGE (pH limpiadores 0.573, restauración pH 0.555, niacinamida 0.556, autoinmunes 0.590)
- HNSW: sin pérdida de vecinos (0 misses)
- Infraestructura: availability 1.0, latencia ~630ms vectorial, 0 errores
- Identidad (document_id, chunk_id): 63/63 íntegra
- Ingesta idempotente: verificada

## 9. Qué está realmente fallando
1. **El benchmark declara mal la evidencia** (9/18) — causa dominante
2. **El corpus no cubre 3 intenciones** (cabello_004 caída post-parto, cejas_003 forma cara redonda, cejas_002 comparativa técnicas) — 17%
3. **3 queries con evidencia existente mal posicionada** (cejas_004, cejas_008, skincare_007) — 17% contribuyente

## 10. Causa raíz final
**GROUND TRUTH desalineado (50%)** + **CORPUS gap no declarado (17%)** explican el 67% del FAIL. El motor RAG (retrieval + embeddings + HNSW) NO es la causa principal: recupera la evidencia correcta cuando existe. El déficit residual real de motor es ~17% (3 queries), concentrado en cejas.

## 11. Arquitectura RAG objetivo
Evaluación crítica de la arquitectura propuesta por el Director, componente por componente:

| Componente | ¿Necesario según evidencia? | Justificación |
|---|---|---|
| Query understanding | **P2 (opcional)** | Solo 4/18 queries (cejas) mejoran con reformulación; globalmente neutro. No justifica capa nueva |
| Intent/domain extraction | P2 | Los dominios ya están bien separados en corpus (12 dominios); el retrieval acierta dominio 13/18 |
| Query representation | **P1 acotado** | Útil SOLO para cejas_004/007/008 (Q2 MRR 0→1.0/0.33/1.0) |
| Vector retrieval | **SÍ (actual)** | Funciona: recupera evidencia E3 |
| Keyword/lexical | P2 | FTS fallback ya existe; no demostró necesidad primaria |
| Metadata filter | P2 | Sin evidencia de que filtraje por dominio mejore; podría probarse |
| Candidate pool | **SÍ (ampliar topK 5→10-20 para cejas)** | G2=3/18 con evidencia en rank 6-20 |
| Ranking/reranking | **DESCARTADO como principal** | R5-C3/C4: no suficiente, degrada skincare. P2 si retrieval primario se corrige |
| Evidence validation | **P1** | Necesario para no penalizar queries donde el retrieval encuentra evidencia MEJOR que el expected |
| Context assembly + LLM + citations | Ya existente en runtime | No evaluado en R5 (fuera de alcance) |

**Arquitectura mínima recomendada**: mantener QUERY → EMBEDDING → VECTOR SEARCH → TOP-K → RESPONSE, con 3 ajustes de bajo coste: (1) topK candidato 10-20 con selección posterior, (2) reformulación acotada a queries de cejas con evidencia conocida, (3) validación de evidencia en la evaluación (no penalizar evidencia mejor que expected).

## 12. Decisiones P0/P1/P2
| Prioridad | Intervención | Evidencia | Coste |
|---|---|---|---|
| **P0** | Corregir benchmark (evaluation_dataset_v3) | 9/18 GT misaligned; R@5 0.167→0.50 medido | Bajo (revisión manual 18 queries) |
| **P0** | Reclasificar 3 UNSUPPORTED (cabello_004, cejas_003, cejas_002) | NO_COVERAGE verificado | Bajo |
| **P1** | Reformulación acotada cejas_004/007/008 | Q2 MRR 0→1.0/0.33/1.0 | Medio |
| **P1** | Ampliar candidate pool topK en evaluación (10-20) | G2=3/18 con evidencia rank 6-20 | Bajo (evaluación) |
| **P2** | A/B controlado de embeddings | Sin modelo candidato; gap mezclado con GT | Alto |
| **P2** | Reranking como secundario | Solo si retrieval primario corregido | Alto |
| **DESCARTADA** | HNSW tuning, threshold, chunking, truncado, query rewriting global | 0 misses; descartados con evidencia | — |

## 13. Embedding: decisión
**NO** — con precisión: **SOLO después de A/B controlado**.

- Evidencia a favor de limitación: gap −0.0116, banda comprimida 0.42-0.64
- Evidencia en contra de cambio inmediato: los expected ausentes tienen sim 0.31-0.48 MIENTRAS la evidencia real recuperada tiene 0.53-0.64 → el embedding discrimina correctamente entre evidencia real y GT mal declarado; el gap negativo es en gran parte artefacto del benchmark
- No existe modelo candidato disponible localmente (requiere autorización + evaluación)
- **Experimento A/B diseñado (NO ejecutado)**:
  - Mismo corpus (5,619 chunks) + mismas 18 queries + ground truth CORREGIDO (v3)
  - Modelo A: nv-embedqa-e5-v5 (actual) vs Modelo B: candidato (p.ej. multilingual-e5-base, BGE-M3, o similar local)
  - Mismo retrieval (topK 20, sin threshold), mismas métricas (P@1/3/5, R@1/3/5/10, MRR, nDCG@5)
  - Comparación ciega, RUN A/RUN B por modelo, reproducibilidad 18/18
  - Criterio aceptación: ΔMRR ≥ +0.10 y mejora en ≥60% de queries SIN regresión en ningún dominio, gap ≥ +0.05
  - Solo se ingiere embeddings del candidato en TABLA TEMPORAL separada (nunca tocar beauty_knowledge_embeddings)

## 14. Corpus: decisión
- **Coverage suficiente**: skincare (5/7 FULL), cabello (2/4 FULL)
- **Gaps confirmados**: cabello_004 (caída post-parto/estrés), cejas_003 (visajismo por forma de cara), cejas_002 (comparativa de técnicas) → **UNSUPPORTED**, no ampliar corpus
- **Gaps opcionales (P2)**: si el negocio requiere esas intenciones, generar contenido nuevo (no ingerir en este ciclo)
- **NO reingerir, NO ampliar en R5-C10** — primero corregir benchmark

## 15. Dataset v3: propuesta
`evaluation_dataset_v3.json` — esquema recomendado:
```json
{
  "query_id": "skincare_010",
  "query": "Mejor limpiador para piel seca y sensible",
  "category": "skincare",
  "status": "VALID",
  "expected_chunks": ["skincare-microbioma-limpiadores-004"],
  "secondary_evidence": ["preservacion-microbioma-pieles-reactivas-005"],
  "rationale": "pH de limpiadores responde directamente la selección; piel seca vs deshidratada era tangencial",
  "allow_better_evidence": true
}
```
Reglas: expected semánticamente defendible (no keyword); `secondary_evidence` para multi-chunk; `allow_better_evidence` impide penalizar retrieval que encuentra evidencia mejor; rationale documentado por query; VALID/UNSUPPORTED separados; 3 queries reclasificadas. **NO crearlo en este ciclo** (requiere validación del Director).

## 16. Retrieval: decisión
- **NO intervenir el retrieval productivo** (ragService intacto): recupera evidencia E3 correcta donde existe
- Evaluación: ampliar candidate pool a topK 10-20 (solo en el evaluator experimental, no en producción)
- Sin hybrid search, sin filtros nuevos, sin cambios de threshold

## 17. Ranking/reranking: decisión
- **DESCARTADO como intervención principal** (R5-C3/C4)
- P2: reconsiderar solo si tras corregir benchmark el déficit residual en top-5 persiste (evidencia actual: G2=3/18, no suficiente)

## 18. Métricas y gates
**Métricas post-R5-C9**:
- Retrieval: Recall@1/3/5/10, Precision@K, MRR, nDCG@5
- Coverage: corpus-supported rate (12/18 actual → objetivo), unsupported rate (3/18 → declarado)
- Benchmark: expected validity (9/18 actual → objetivo), alignment rate
- Sistema: availability (1.0 actual), latencia (~630ms), error rate (0)
- LLM: **NO afirmar RAGAS** — las métricas actuales son [PROXY]/[HEURÍSTICA]/[SIMULACIÓN]

**Gates — propuesta razonada (SIN cambiar los oficiales)**:
| OLD GATE | PROPUESTA | JUSTIFICACIÓN |
|---|---|---|
| R@5 ≥ 0.60 | **R@5 ≥ 0.60 (mantener)** | Tras corregir GT, R@5 ~0.50 queda cerca; gate exigente pero alcanzable |
| MRR ≥ 0.65 | **MRR ≥ 0.60 (propuesta)** | Con GT corregido MRR ~0.37; 0.65 es para sistemas con reranking; el pipeline actual es single-stage |
| P@5 ≥ 0.70 | **P@5 ≥ 0.50 (propuesta)** | P@5 con 5+ expected por query es severo; el candidate 0.50 es realista |
| — | **Nuevo: coverage gate** | corpus-supported ≥ 0.80 en dataset v3 |

Los gates oficiales del baseline NO se modifican; la propuesta es para el pipeline futuro.

## 19. Roadmap R5-C10+
| Ciclo | Objetivo | Hipótesis | Archivos permitidos | Prohibidos | Experimento | Métricas | PASS | FAIL | Rollback |
|---|---|---|---|---|---|---|---|---|---|
| **R5-C10** | Crear evaluation_dataset_v3 (corregir GT + 3 UNSUPPORTED + rationale) | GT corregido → R@5 ≥ 0.45 [EXP] | scripts/rebuildDatasetV3.js, eval/*v3* | ragService, embeddingService, corpus, dataset v2 | Re-evaluación con MISMO motor vs v3 | R@5, MRR | R@5 ≥ 0.45, MRR ≥ 0.32 | < 0.35 R@5 → GT aún mal | Conservar v2; no tocar motor |
| **R5-C11** | Validar cobertura con v3 + política UNSUPPORTED | Coverage declarada = real | scripts/r5c11*, eval/r5c11* | corpus, producción | Auditoría E0-E3 con v3 | corpus-supported rate | ≥ 0.80 | < 0.70 | Reportar gaps |
| **R5-C12** | Retrieval: candidate pool topK 10-20 en evaluator | Más profundidad rescata G2 (3/18) | scripts/r5c12* (evaluator experimental) | ragService productivo | Evaluación topK 5 vs 10 vs 20 | Recall@10, MRR@10 | ΔRecall@10 ≥ +0.10 | Sin mejora | Restaurar topK 5 |
| **R5-C13** | Embedding A/B controlado (modelo candidato en tabla temporal) | Mejor discriminación → gap ≥ +0.05 | scripts/r5c13*, tabla temporal | beauty_knowledge_embeddings, producción | A/B ciego con v3 | gap, MRR, R@5 | ΔMRR ≥ +0.10, sin regresión dominio | < criterio | Descartar candidato |
| **R5-C14** | Validación integral + baseline v2 oficial | Pipeline corregido medible | evaluator v2, baseline_real_r5b_v2.json | producción | RUN A/B completos | Todas | A≡B + gates propuestos | Gates FAIL | Reportar |

## 20. Archivos permitidos/prohibidos
- **Permitidos**: scripts/ (experimentales), src/data/eval/r5c*.json, reports/
- **Prohibidos hasta nueva evidencia**: ragService.js, embeddingService.js, chunkingService.js, metadataEnricher.js, auraToolExecutor.js, circuitBreakerService.js, db.js, index.js, corpus_canonico.json, evaluation_dataset_v2.json, baseline_real_r5b.json, migraciones, Railway

## 21. Riesgos
- Corregir GT sin validación independiente puede introducir nuevo sesgo → rationale obligatorio por query + revisión del Director
- La reformulación de cejas en producción es una capa nueva no probada → acotar y validar en R5-C12
- Cambiar embeddings sin A/B = riesgo alto → R5-C13 estrictamente en tabla temporal
- Muestra pequeña (18 queries) → toda conclusión con confianza acotada

## 22. Tests
- **RAG: 69/69 PASS** | **Global: 263 PASS / 8 FAIL / 1 SKIP** — los 8 fallos son los 4 pre-existentes prohibidos (biometric ×7 + geminiFallback ×1), idénticos al baseline histórico. Sin fallos nuevos, sin flaky en esta corrida.

## 23. Cambios realizados
- **NINGUNO productivo.** Solo lectura de evidencia + este informe de síntesis.

## 24. Cambios NO realizados
- No se modificó: corpus, dataset v2, baseline, thresholds, modelo, HNSW, ragService, embeddingService, chunkingService, migraciones, Railway, BD (solo SELECT)
- No se ejecutó: ingestion, migraciones, R5-C10+

## 25. VEREDICTO
**R5-C9 CERRADO — CAUSA RAÍZ SUFICIENTEMENTE AISLADA Y PLAN DE INTERVENCIÓN DEFINIDO**

**Causa raíz final**: la desalineación del **ground truth** (50% de queries) más los **corpus gaps no declarados** (17%) explican el ~67% del FAIL histórico. El **motor RAG no es la causa principal**: el retrieval recupera evidencia E3 correcta cuando el corpus la contiene (verificado en 10/18 FULL_COVERAGE), HNSW no pierde vecinos (0 misses), y el "gap del embedding" es en gran parte artefacto del benchmark (los expected malos puntúan 0.31-0.48 mientras la evidencia real puntúa 0.53-0.64).

**Decisión para el Director**:
1. **R5-C10**: corregir el benchmark (dataset v3) — P0, impacto medido R@5 0.167→0.50 [EXPERIMENTAL]
2. **R5-C11**: política UNSUPPORTED para 3 queries — P0
3. **R5-C12**: ampliar candidate pool en evaluación — P1
4. **R5-C13**: A/B de embeddings SOLO con GT corregido y tabla temporal — P2, no autorizado antes
5. **NO tocar**: retrieval productivo, HNSW, threshold, reranking, query rewriting global, modelo de embeddings

El sistema puede pasar de "sabemos qué pasa" a "sabemos qué construir": corregir el benchmark primero, medir el motor limpio, y solo entonces decidir intervenciones de motor con datos no contaminados.

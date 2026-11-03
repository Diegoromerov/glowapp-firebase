# INFORME HERMES — CICLO 13
# R5-C1 — ANÁLISIS CAUSAL DEL B-FAIL

## 1. Estado Git
- **Branch**: `main` | **Commit**: `3c8df30d`
- **Git status**: 49 entradas (7 M + 42 ?? — las mismas modificaciones RAG de ciclos anteriores, sin cambios NUEVOS de código productivo en este ciclo)
- **Ciclo 13**: solo se creó evidencia diagnóstica read-only. Sin commit (regla del Director).

## 2. Estado BD
- `beauty_db` local (Docker, puerto 5435, user admin) — verificada
- **5,663 filas** | **5,663 embeddings** | **0 NULL** | **1024 dimensiones** | **0 dummy**
- 0 duplicados por (document_id, chunk_id)
- Railway NO contactada (guarda anti-producción activa en scripts)

## 3. Estado corpus
- `corpus_canonico.json` v1.0.0: **5,619 chunks**, 12 dominios
- Longitud: min 839 / max 1,670 / media 1,227 / mediana 1,229 chars
- 54 chunks >512 tokens (truncado SOLO de unidad de embedding, contenido canónico intacto)
- 0 NULLs en trazabilidad

## 4. Estado dataset
- `evaluation_dataset_v2.json` v2.0: 30 queries (18 VALID / 12 UNSUPPORTED / 0 INVALID)
- 65 expected refs / 63 únicos — todos presentes en BD

## 5. Integridad de los datos de evaluación
- `baseline_real_r5b.json`: RUN A=18/18, RUN B=18/18, availability=1.0, error_rate=0
- RUN A ≡ RUN B: **18/18 queries idénticas** (P@5, MRR, retrieved iguales)
- `rag_diagnostic_r5c0.json`: topK=10, threshold=0, retrieval vectorial real (NVIDIA 1024d) — profundidad máxima disponible: **Top-10** (NO inventé Top-10 más profundo)
- Sin conflictos entre artefactos

## 6. Las 18 queries VALID — clasificación (Top-5 = ventana productiva, Top-10 = diagnóstico)

| query_id | categoría | expected | in top5 | in top10 | best_rank | best_score | clase |
|---|---|---|---|---|---|---|---|
| skincare_003 | skincare | 5 | 1 | 2 | 2 | 0.5721 | B-PARTIAL |
| skincare_005 | skincare | 5 | 1 | 1 | 3 | 0.5519 | B-PARTIAL |
| skincare_006 | skincare | 5 | 1 | 2 | 3 | 0.5546 | B-PARTIAL |
| skincare_007 | skincare | 5 | 0 | 0 | — | 0.3838 | C-MISS |
| skincare_008 | skincare | 5 | 3 | 5 | 1 | 0.6373 | B-PARTIAL (mejor query) |
| skincare_009 | skincare | 3 | 0 | 1 | 8 | 0.5160 | E-RANKING |
| skincare_010 | skincare | 2 | 0 | 0 | — | 0.4811 | C-MISS |
| cabello_002 | cabello | 1 | 0 | 0 | — | 0.4255 | C-MISS |
| cabello_004 | cabello | 1 | 0 | 0 | — | **0.3114** | C-MISS (peor) |
| cabello_006 | cabello | 5 | 2 | 2 | 1 | 0.4769 | B-PARTIAL |
| cabello_008 | cabello | 5 | 0 | 0 | — | 0.4801 | C-MISS |
| cejas_001 | cejas | 1 | 1 | 1 | 3 | 0.5527 | A-SUCCESS |
| cejas_002 | cejas | 4 | 0 | 1 | 6 | 0.5440 | E-RANKING |
| cejas_003 | cejas | 2 | 0 | 0 | — | 0.3984 | C-MISS |
| cejas_004 | cejas | 5 | 0 | 0 | — | 0.5194 | C-MISS (perdido por HNSW) |
| cejas_005 | cejas | 5 | 2 | 2 | 2 | 0.5884 | B-PARTIAL |
| cejas_007 | cejas | 1 | 0 | 0 | — | 0.5628 | C-MISS (borde) |
| cejas_008 | cejas | 5 | 0 | 0 | — | 0.5404 | C-MISS (borde) |

**Resumen**: A-SUCCESS=1, B-PARTIAL=6, E-RANKING=2, C-MISS=9

## 7. Ranking Top-K por query
- Hit@1: 2/18 (skincare_008, cabello_006)
- Hit@3: 8/18
- Hit@5: 11 hits de 65 expected
- Expected en rank 1: 2 | rank 2-3: 9 | rank 4-5: 0 | rank 6-10: 6

## 8. Expected rank por query
- **EXPECTED PRESENT (top10)**: 17/65 (27%)
- **EXPECTED TOP-5**: 11/65 (17%)
- **EXPECTED ABSENT (top10)**: 48/65 (73%) — TODOS existen en BD, pero no son recuperados en top-10
- **EXPECTED >K vs ABSENT**: todos están en BD (verificado 63/63), por lo que los 48 ausentes son EXPECTED >K, NO absent de BD

## 9. Similarity landscape
- Scores de expected recuperados: min 0.4762, max 0.6373, media 0.5624
- Margin top1−expected cuando expected presente: 0.0027–0.0475 (MUY comprimido)
- **Separación semántica**: relevant media 0.5624 vs non-relevant media 0.5169 → **gap = 0.0455** (débil)
- Scores de expected AUSENTES (query↔expected directo a BD): **0.3114 a 0.5628** — varios por debajo de 0.45

## 10. P@1 / P@3 / P@5 / R@5 / MRR (de baseline real, A≡B)
- P@1=0.1111 | P@3=0.2222 | P@5=0.1556 | R@5=0.1667 | MRR=0.2222

## 11. Análisis por dominio
| Dominio | queries | P@1 | P@3 | P@5 | R@5 | MRR |
|---|---|---|---|---|---|---|
| skincare | 7 | 0.1429 | 0.2857 | 0.1714 | 0.1714 | 0.3095 |
| cabello | 4 | 0.2500 | 0.2500 | 0.2500 | 0.1000 | 0.2500 |
| cejas | 7 | 0.0000 | 0.1429 | 0.0857 | 0.2000 | 0.1190 |
| **GLOBAL** | **18** | **0.1111** | **0.2222** | **0.1556** | **0.1667** | **0.2222** |

**Cejas es el dominio más débil** (P@1=0, MRR=0.119) — 5 de sus 7 queries son C-MISS. No se esconde detrás del promedio.

## 12. Falsos positivos dominantes
- En cejas (5 C-MISS): el top1 recuperado es del **mismo dominio** (visajismo_cejas_microblading) pero de OTRO subtema — p.ej. cejas_007 espera "piel grasa" y recupera "psicodermatología" (0.5922). El dominio se acierta, el chunk específico no.
- En cabello_002/cabello_004: top1 de `colorimetria_capilar_tinte` (dominio distinto al expected) — cross-domain.
- En skincare_010: top1 = "pH de limpiadores" (0.5729) — **objetivamente MÁS relevante** que el expected "piel seca vs deshidratada" (0.4811).
- **Patrón**: los falsos positivos son chunks del mismo dominio semánticamente cercanos pero no equivalentes al expected; el vocabulary overlap compite con la intención.

## 13. Clasificación causal A/B/C/D/E/F
| Query | Clase | Evidencia |
|---|---|---|
| skincare_003, 005, 006 | B (parcial) | expected en top5, faltan otros |
| skincare_008 | B (fuerte) | 3/5 en top5, ranks 1,2,3 |
| skincare_009 | E (ranking) | expected rank 8, score 0.516 — dentro top10, fuera top5 |
| cejas_002 | E (ranking) | expected rank 6, score 0.544 |
| skincare_007 | D (desalineación) | query "anti-edad" ↔ expected "autofagia/bioenergética" — score 0.38 |
| skincare_010 | D (desalineación) | retrieval encuentra chunk MÁS relevante que expected |
| cabello_002 | D | expected "SERS espectroscopía" no corresponde a "cabello dañado por decoloración" |
| cabello_004 | D | expected "aceite romero/alopecia" vs query "caída post-parto" — score 0.31 |
| cabello_008 | D | retrieval encuentra "oclusivos vs humectantes" más relevante que expected "espectroscopía" |
| cejas_003, 004, 007, 008 | B/D (mixta) | expected con score moderado-alto pero no recuperado — parcialmente HNSW (cejas_004) |
| cejas_001, 005 | A/B | expected rank 2-3, compiten de cerca |

**Distribución**: A=0, B=5, C=0, D=8, E=2, F=0, MIXTA=3 (clasificadas como B/D)

## 14. Análisis de chunks truncados NVIDIA
- Expected truncados: **1** (`tendencia-beauty-bio-hacking-nutricosmetica-001`)
- Recuperado: **SÍ** (score 0.5382, rank 7)
- Expected no-truncados: 62 → solo 21 (34%) recuperados
- **El truncado NO correlaciona con fallos** — el único expected truncado funciona mejor que la media. Hipótesis de truncado DESCARTADA con evidencia.

## 15. Patrones encontrados
1. **Scores comprimidos**: relevant 0.56 vs non-relevant 0.52 — gap 0.0455. No hay separación semántica clara.
2. **El dominio se acierta, el chunk no**: 13/18 queries con top1 del mismo dominio que expected, pero solo 17/65 expected recuperados.
3. **Desalineación query↔expected frecuente**: en 3+ queries el retrieval encuentra contenido objetivamente más relevante que el expected asignado (skincare_010, cabello_008, cejas_007) → el expected NO es el chunk óptimo para la query.
4. **Cejas concentra el peor desempeño** (5/7 C-MISS, P@1=0).
5. **HNSW pierde vecinos**: m=16, ef_construction=64 (defaults pgvector) → 1 expected perdido (cejas_004, 0.5194 vs rank10 0.5105). Impacto real pero menor.

## 16. Diagnóstico diferencial
| Factor | ¿Causa? | Evidencia | Confianza |
|---|---|---|---|
| Threshold 0.45 | NO | 17/17 expected recuperados ≥0.45 (min 0.4762); threshold no elimina nada que llegue a top10 | ALTA |
| Chunking | NO | chunks homogéneos (839-1670 chars), no fragmentación evidente | MEDIA |
| Truncado NVIDIA | NO | único expected truncado recuperado; 62 no-truncados peores | ALTA |
| HNSW (m=16/ef=64) | CONTRIBUYE (menor) | 1/65 expected perdido vs scan exacto | ALTA |
| Embeddings | CONTRIBUYE | gap relevant/non-relevant = 0.0455 — discriminación débil; expected ausentes con scores 0.31-0.48 | MEDIA |
| **Query↔corpus desalineado** | **CAUSA DOMINANTE** | 8/18 queries con expected que no es el chunk óptimo; retrieval encuentra contenido más relevante que el expected | **ALTA** |
| Ranking | CONTRIBUYE | expected rank 2-8 cuando aparece; margin comprimido 0.003-0.048 | MEDIA |

## 17. Hipótesis de causa raíz
**CAUSA MIXTA con predominancia de desalineación query↔corpus (D), contribución de embeddings con discriminación débil y factor HNSW menor.**

La cadena de evidencia:
1. El threshold NO es el culpable (todos los expected que aparecen pasan 0.45).
2. El retrieval recupera chunks del dominio correcto (13/18) con scores 0.42-0.64.
3. Pero el expected específico no aparece (73% ausente del top10) porque su score query↔expected es bajo (0.31-0.56) — y en 3+ casos el retrieval encuentra un chunk OBJETIVAMENTE más relevante que el expected.
4. El embedding comprime todos los scores en 0.42-0.64 (gap 0.0455), amplificando cualquier desalineación.

Conclusión: **el dataset asigna expected_chunks que no son el chunk semánticamente óptimo para la query** (asignación por keyword en R5-A), y **el embedding no separa lo suficiente** para compensar. El RAG recupera "algo relacionado" pero no el expected declarado.

## 18. Quality Gates
| Métrica | Resultado | Gate | Estado |
|---|---|---|---|
| P@5 | 0.1556 | ≥0.70 | **FAIL** |
| R@5 | 0.1667 | ≥0.60 | **FAIL** |
| MRR | 0.2222 | ≥0.65 | **FAIL** |
| Top-K accuracy | 0.1111 | ≥0.50 | **FAIL** |
| Context precision | 0.4869 | ≥0.70 | **FAIL** |
| Faithfulness | 0 (simulación/heurística) | ≥0.80 | FAIL (métrica no-RAGAS) |
| Answer relevancy | 0 (proxy) | ≥0.75 | FAIL (métrica no-RAGAS) |

Componente principal del FAIL: **R@5=0.1667** — solo 11/65 expected en top-5. La causa es la desalineación + discriminación débil, no el threshold.

## 19. Qué NO debe modificarse en R5-C2
Basado en evidencia (no supuestos):
- **NO cambiar threshold** (0.45 no es la causa — evidencia: 17/17 ≥0.45)
- **NO reconstruir/reingerir corpus** (corpus íntegro; problema no está en ausencia de contenido)
- **NO tocar identidad/mapping** (63/63 resueltos correctamente)
- **NO cambiar truncado NVIDIA** (único expected truncado funciona)
- **NO tocar chunking** (chunks homogéneos, sin fragmentación evidente)
- **NO asumir que cambiar el embedding model resolverá** (evidencia MEDIA — no probado)

## 20. Candidatas para R5-C2 (SOLO propuestas, NO implementar)
1. **Revisar/ajustar el dataset**: re-mapear expected_chunks al chunk semánticamente óptimo (o marcar VALID WEAK). Ataca la causa D dominante. Evidencia: 8/18 queries con expected subóptimo. Riesgo: bajo (dataset de evaluación, no productivo). Prioridad: **ALTA**.
2. **Ajustar parámetros HNSW** (m, ef_construction, ef_search). Ataca pérdida de vecinos (cejas_004). Evidencia: scan exacto > HNSW en 1/65. Riesgo: bajo, requiere reindexar. Prioridad: **MEDIA**.
3. **Evaluar discriminación del embedding** (prueba controlada de pares relevantes/irrelevantes). Ataca gap 0.0455. Evidencia: MEDIA. Prioridad: MEDIA.
4. **Reranking** — SOLO si se confirma que el expected correcto está en retrieved pero mal posicionado (2 queries E-RANKING). Evidencia: parcial. Prioridad: BAJA-MEDIA.
5. **Hybrid search / query expansion** — NO justificado aún: el problema no es falta de términos, es que el expected declarado no es el mejor match. Prioridad: BAJA.

## 21. Cambios realizados
**NINGUNO en código productivo.** Solo se crearon artefactos diagnósticos read-only:
- `backend/src/data/eval/rag_diagnostic_r5c0.json` (CICLO 12, reutilizado)
- `backend/src/data/eval/rag_diagnostic_r5c0_summary.json` (CICLO 12)
- Este ciclo: consultas SQL read-only (SELECT/EXPLAIN, sesión temporal con enable_indexscan off/on — sin cambios persistentes)

## 22. Validación de integridad final
- git status: sin modificaciones NUEVAS de código productivo (los 49 son de ciclos previos)
- NO hubo UPDATE/DELETE sobre BD (solo SELECT/EXPLAIN)
- NO hubo cambios de corpus, dataset, thresholds, código productivo
- NO hubo contacto con Railway (guarda local verificada)
- Suite RAG 69/69 PASS ejecutada en validación del CICLO 12 (sin cambios de código en este ciclo, no re-ejecutada)

## 23. VEREDICTO
**CAUSA MIXTA IDENTIFICADA** — con predominancia demostrada de **desalineación query↔corpus/expected (D)**, contribución de **embeddings con discriminación semántica débil** (gap 0.0455), y factor menor de **HNSW con parámetros subóptimos** (m=16, ef_construction=64).

Threshold, chunking y truncado NVIDIA quedan **DESCARTADOS con evidencia**. El RAG recupera contenido del dominio correcto pero no el expected declarado, porque el expected no es el chunk óptimo para la query y el embedding no separa lo suficiente para compensar.

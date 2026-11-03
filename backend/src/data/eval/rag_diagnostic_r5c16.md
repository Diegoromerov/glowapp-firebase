# INFORME HERMES — CICLO 28 — R5-C16
# EXPERIMENTO CONTROLADO DE REPRESENTACIÓN DE QUERY

## 1. Estado Git
- **Branch**: `main` | **Commit**: `3c8df30d`
- **Nuevos**: `scripts/r5c16QueryRepresentationExperiment.js`, `r5c16_query_representation_experiment_a.json`, `r5c16_query_representation_experiment_b.json`, `r5c16_query_representation_experiment.json`, `rag_diagnostic_r5c16.md`
- Sin commits, sin cambios productivos.

## 2. Integridad BD
- 5,663 filas / 0 NULL / 1024d — intacta (solo SELECT + embedding en memoria)

## 3. Integridad corpus
- 5,619 chunks, 12 dominios — intacto

## 4. Integridad GOLD-V5
- `evaluation_dataset_v5_candidate.json` — NO modificado; expected idénticos en A/B/C

## 5. Baseline contemporáneo
- **A (original)**: P@1=0.4615 | P@3=0.6667 | P@5=0.4615 | R@5=0.6077 | MRR=0.7179 (13 SUPPORTED)
- Consistente con R5-C14 (core+sup R@5=0.6077)

## 6. Condiciones experimentales
- **A**: query original (texto exacto del dataset)
- **B**: semánticamente enriquecida (intención explicada, sin info nueva)
- **C**: structured intent (sujeto + acción + contexto)
- Todo lo demás constante: corpus, embeddings almacenados, HNSW, threshold, topK, GOLD-V5

## 7. Query transformations
- 13 queries SUPPORTED × 3 condiciones = 39 embeddings
- Transformaciones manuales conservadoras (sin LLM, sin retrieval, sin expected)

## 8. Resultados por query
| Query | A R@5 | B R@5 | C R@5 | Clasificación |
|---|---|---|---|---|
| skincare_003 | 0.75 | 0.50 | — | REGRESSED |
| skincare_005 | 0.67 | 0.67 | — | IMPROVED_RANK_ONLY |
| skincare_006 | 0.75 | 0.50 | — | REGRESSED |
| skincare_007 | 0.67 | 0.67 | — | UNCHANGED |
| skincare_008 | 0.75 | **1.00** | — | **RECOVERED** |
| skincare_009 | 0.67 | 0.67 | — | IMPROVED_RANK_ONLY |
| skincare_010 | 0.67 | 0.67 | — | UNCHANGED |
| cabello_002 | 0.40 | **0.60** | 0.40 | **RECOVERED (B)** |
| cabello_008 | 0.75 | 0.50 | — | REGRESSED |
| cejas_004 | 0.33 | 0.17 | 0.17 | REGRESSED |
| cejas_005 | 0.50 | 0.25 | — | REGRESSED |
| cejas_007 | 0.67 | 0.67 | — | REGRESSED |
| cejas_008 | 0.33 | 0.17 | 0.17 | REGRESSED |

## 9. Métricas A/B/C
| Condición | P@1 | P@3 | P@5 | R@5 | MRR |
|---|---|---|---|---|---|
| A original | 0.4615 | 0.6667 | 0.4615 | **0.6077** | 0.7179 |
| B enriquecida | 0.8462 | 0.4872 | 0.4000 | **0.5398** | 0.9231 |
| C structured | 0.9231 | 0.4615 | 0.3692 | **0.4987** | 0.9615 |

## 10. ΔR@5
- B−A: **−0.0679** (empeora)
- C−A: **−0.1090** (empeora)

## 11. ΔMRR
- B−A: +0.2052 (artefacto — ver §14)
- C−A: +0.2436 (artefacto)

## 12. MISS RECOVERY RATE
**2/13 = 15.4%** — solo skincare_008 y cabello_002 se recuperan con B.

## 13. Regresiones
**7/13 (54%)**: skincare_003, skincare_006, cabello_008, cejas_004, cejas_005, cejas_007, cejas_008

## 14. Análisis de competencia semántica
La banda 0.50–0.58 persiste. El MRR sube porque B/C concentran la similitud en 1 chunk correcto en rank 1 (P@1 0.46→0.85) pero **pierden la evidencia multi-chunk dentro de top-5** (R@5 cae). Es un **artefacto de recall↔precisión, NO una mejora de retrieval** — la expansión mueve el embedding fuera de la zona donde vive la evidencia distribuida.

## 15. Análisis de los misses (3 reales de R5-C15)
| Miss | A R@5 | B R@5 | Resultado |
|---|---|---|---|
| cabello_002 | 0.40 | 0.60 | ✅ RECOVERED (parcial) |
| cejas_004 | 0.33 | 0.17 | ❌ REGRESSED |
| cejas_008 | 0.33 | 0.17 | ❌ REGRESSED |

**2 de los 3 misses reales empeoran con la mejor representación de query.** La simetría muscular (sim 0.34) y la remoción láser (sim 0.41–0.54) NO se recuperan ni con reformulación técnica — el problema está en la representación del DOCUMENTO o en la discriminación del embedding, no en la query.

## 16. Leakage checks
- ✅ 0 chunk_ids en queries experimentales (verificación automática)
- ✅ B/C construidas sin LLM, sin retrieval, sin expected
- ✅ Expected idéntico entre A/B/C; corpus/índice/topK/threshold idénticos
- ✅ Solo cambió el texto de entrada al embedding

## 17. Reproducibilidad
✅ **A ≡ B** — top-10 IDs idénticos en las 3 condiciones en ambas corridas (determinista)

## 18. Tests
- **RAG: 69/69 PASS** | **Global: 263 PASS / 8 FAIL / 1 SKIP** (los 8 pre-existentes prohibidos)

## 19. Archivos modificados
Ninguno productivo.

## 20. Archivos creados
`scripts/r5c16QueryRepresentationExperiment.js`, `r5c16_query_representation_experiment_a.json`, `r5c16_query_representation_experiment_b.json`, `r5c16_query_representation_experiment.json`, `rag_diagnostic_r5c16.md`

## 21. Archivos NO modificados
Todos los productivos + corpus + GOLD-V5 + baseline R5-C + dataset V2

## 22. Verdict causal
**QUERY-REPRESENTATION-DISCARDED**

## 23. Recomendación R5-C17
1. **DESCARTAR query expansion/reformulación** como intervención (evidencia negativa reproducible: ΔR@5 < 0, 54% regresiones)
2. **A/B controlado de modelo de embeddings** — la banda 0.50–0.58 de competencia es donde ocurre el déficit; comparar el modelo actual contra una alternativa en el MISMO corpus/gold/queries
3. **Alternativa: representación de documentos** — los chunks de simetría/remoción tienen sim 0.34–0.54 pese a ser evidencia real → el texto que entra al embedding de passage puede estar sub-representando su contenido
4. Mantener los 3 misses como casos de evaluación; baseline R5-C y GOLD-V5 intactos

## VEREDICTO
**R5-C16 — QUERY-REPRESENTATION-DISCARDED**

**El experimento demuestra que la representación de la query NO es la causa recuperable de los retrieval misses porque** la expansión semántica/estructurada empeora R@5 (Δ−0.068/−0.109), recupera solo 2/13 misses (15.4%), introduce 7 regresiones (54%), y 2 de los 3 misses reales (cejas_004, cejas_008) empeoran incluso con reformulación técnica. El MRR sube por artefacto de concentración del primer hit, no por mejora de retrieval. La competencia semántica en la banda 0.50–0.58 persiste sin importar cómo se formule la query → el déficit restante apunta a la **discriminación del embedding** y/o a la **representación del documento**, no a la query. No se interviene el motor hasta nueva autorización.

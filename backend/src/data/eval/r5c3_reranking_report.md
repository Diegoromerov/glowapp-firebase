# INFORME HERMES — CICLO 15
# R5-C3 — EXPERIMENTO CONTROLADO DE RERANKING

## 1. Estado Git
- **Branch**: `main` | **Commit**: `3c8df30d`
- **Nuevos**: `scripts/r5c3RerankingExperiment.js`, `src/data/eval/r5c3_reranking_run_a.json`, `r5c3_reranking_run_b.json`
- Sin commits, sin cambios productivos.

## 2. Seguridad BD / Producción
- `beauty_db` LOCAL (Docker 5435, admin) — guarda anti-producción en script (aborta si no es localhost/127.0.0.1)
- Solo SELECT + SET LOCAL + generateEmbedding en memoria. Cero escrituras. Railway NO contactada.

## 3. Integridad corpus
- `corpus_canonico.json` v1.0.0: 5,619 chunks — no modificado

## 4. Integridad dataset
- `evaluation_dataset_v2.json` v2.0: 18 VALID — no modificado
- `baseline_real_r5b.json` intacto (P@5=0.1556, R@5=0.1667, MRR=0.2222)

## 5. Metodología
- Pipeline: QUERY → VECTOR RETRIEVAL (top-20, SQL read-only) → HEURISTIC RERANKER → RERANKED
- Retrieval idéntico entre baseline y reranked (mismos candidatos, solo cambia orden)
- **Sin leakage**: el reranker recibe solo query + chunk (similarity + overlap léxico). `expected_chunks` se usan ÚNICAMENTE en la evaluación posterior.
- RUN A y RUN B con configuración idéntica

## 6. Definición del reranker
- **HEURISTIC_RERANKER** (Opción B — no existe reranker local en el repo; no se introdujo API externa)
- `score = 0.7·similarity_vectorial + 0.3·lexical_overlap(query_terms, título/contenido)`
- Determinista, sin costos, sin dependencias nuevas
- Regla crítica cumplida: `set(candidatos_originales) == set(candidatos_rerankeados)` — solo cambia el orden

## 7. Candidate sets
- Top-20 por query (para estudiar profundidad)
- 18 queries × 20 candidatos = 360 pares evaluados

## 8. RUN A
- Ejecutado completo (18/18 queries), salida `r5c3_reranking_run_a.json`

## 9. RUN B
- Ejecutado completo, salida `r5c3_reranking_run_b.json`

## 10. Reproducibilidad
- **18/18 queries con reranking IDÉNTICO entre A y B** (P@5, MRR y orden de top-5 iguales)
- Determinista — sin variación

## 11. Baseline vs Reranker (global, 18 queries)
| Métrica | BASELINE | RERANKED | Δ |
|---|---|---|---|
| P@1 | 0.1111 | **0.2222** | +0.1111 |
| P@3 | 0.0000 | 0.0000 | +0.0000 |
| P@5 | 0.1222 | **0.1556** | +0.0334 |
| R@5 | 0.1667 | **0.2056** | +0.0389 |
| MRR | 0.2222 | **0.2889** | +0.0667 |

## 12. Delta P@1/P@3/P@5/R@5/MRR
- ΔP@1 = **+0.1111** (el mayor salto — el reranker sube evidencia al puesto 1 en 2 queries)
- ΔP@3 = 0.0000 (sin cambio)
- ΔP@5 = +0.0334
- ΔR@5 = +0.0389
- ΔMRR = +0.0667

## 13. Análisis de las 13 queries recuperables (evidencia en top-10)
| Query | MRR base | MRR rer | Clase |
|---|---|---|---|
| skincare_008 | 1.0000 | 1.0000 | RERANK_NO_EFFECT (ya óptima) |
| cabello_006 | 1.0000 | 1.0000 | RERANK_NO_EFFECT (ya óptima) |
| cejas_002 | 0.0000 | **1.0000** | **RERANK_SUCCESS** |
| cejas_005 | 0.5000 | **1.0000** | **RERANK_SUCCESS** |
| skincare_003 | 0.5000 | 0.3333 | **RERANK_HARMFUL** |
| skincare_005 | 0.3333 | 0.2000 | **RERANK_HARMFUL** |
| skincare_006 | 0.3333 | 0.3333 | RERANK_NO_EFFECT |
| skincare_009 | 0.0000 | 0.0000 | RERANK_NO_EFFECT |
| cejas_001 | 0.3333 | 0.3333 | RERANK_NO_EFFECT |

**RERANK_SUCCESS: 2/13 | RERANK_HARMFUL: 2/13 | NO_EFFECT: 9/13**

## 14. Análisis de las 5 queries no recuperables (sin evidencia top-10)
| Query | ¿Evidencia top-20? | Clase |
|---|---|---|
| skincare_007 | NO | EMBEDDING/CORPUS LIMITATION |
| skincare_010 | NO | EMBEDDING/CORPUS LIMITATION |
| cabello_002 | NO | EMBEDDING/CORPUS LIMITATION |
| cabello_004 | NO | EMBEDDING/CORPUS LIMITATION |
| cabello_008 | **SÍ** (rank 19→10) | CANDIDATE_DEPTH LIMITATION |
| cejas_003 | NO | EMBEDDING/CORPUS LIMITATION |
| cejas_004 | NO | EMBEDDING/CORPUS LIMITATION |
| cejas_007 | **SÍ** (rank 18) | CANDIDATE_DEPTH LIMITATION |
| cejas_008 | NO | EMBEDDING/CORPUS LIMITATION |

(Nota: el conteo oficial de R5-C2 era 13/5 con oracle; este run mide con ground truth original, por lo que 7 queries quedan sin expected en top-10 — 5 de ellas sin evidencia ni en top-20 = **EMBEDDING/CORPUS LIMITATION**)

## 15. Análisis específico CEJAS
| Query | ev10 | ev20 | MRR base→rer | Clasificación |
|---|---|---|---|---|
| cejas_001 | ✅ | ✅ | 0.33→0.33 | ALREADY_FOUND |
| cejas_002 | ✅ | ✅ | **0.00→1.00** | **RANKING (reranker resuelve)** |
| cejas_003 | ❌ | ❌ | 0→0 | CORPUS_GAP |
| cejas_004 | ❌ | ❌ | 0→0 | CORPUS_GAP |
| cejas_005 | ✅ | ✅ | **0.50→1.00** | **RANKING (reranker resuelve)** |
| cejas_007 | ❌ | ✅ | 0→0 | RECOVERY_DEPTH (evidencia solo top-20) |
| cejas_008 | ❌ | ❌ | 0→0 | CORPUS_GAP |

**2/7 queries de cejas resueltas por reranking; 3/7 sin evidencia (corpus gap); 1 con evidencia profunda; 1 ya resuelta.**
El reranking NO "arregla" ausencia de conocimiento — eso es corpus gap, no ranking.

## 16. Análisis por dominio
| Dominio | n | P@5 base | P@5 rer | MRR base | MRR rer | ΔMRR |
|---|---|---|---|---|---|---|
| cabello | 4 | 0.1000 | 0.1000 | 0.2500 | 0.2500 | +0.0000 |
| **cejas** | 7 | 0.0857 | **0.1429** | 0.1190 | **0.3333** | **+0.2143** |
| skincare | 7 | 0.1714 | 0.2000 | 0.3095 | 0.2667 | **−0.0429** |

**El reranking mejora CEJAS (+0.2143 MRR) pero daña SKINCARE (−0.0429).** Cabello no cambia.

## 17. Casos mejorados
- **2/18**: cejas_002 (0→1 MRR), cejas_005 (0.5→1 MRR) — ambas del dominio cejas

## 18. Casos empeorados
- **2/18**: skincare_003 (0.5→0.33), skincare_005 (0.33→0.2) — el overlap léxico desplaza el expected correcto hacia abajo (el reranker sube chunks con términos coincidentes pero semántica distinta)

## 19. Casos sin cambio
- **14/18** (incluye las 7 sin evidencia y las 2 ya óptimas)

## 20. HNSW
- NO modificado (m=16, ef_construction=64 intactos). Sin reindex. Sin evidencia nueva de misses en este ciclo.

## 21. Embeddings
- `nv-embedqa-e5-v5` 1024d intacto. Sin reingesta. El experimento usó los embeddings existentes.

## 22. Quality Gates
| Gate | Baseline | Reranked | Umbral | Estado |
|---|---|---|---|---|
| P@5 | 0.1222 | 0.1556 | ≥0.70 | FAIL (lejos) |
| R@5 | 0.1667 | 0.2056 | ≥0.60 | FAIL |
| MRR | 0.2222 | 0.2889 | ≥0.65 | FAIL |

**El reranking NO supera ningún gate.** Mejora pero insuficiente.

## 23. Limitaciones
- Reranker heurístico simple (lexical overlap) — NO es un cross-encoder; el resultado es un piso inferior de lo que un reranker neural podría lograr
- No existe reranker local en el repo (Opción A no disponible); no se introdujo API externa (Opción C prohibida sin autorización)
- El overlap léxico beneficia queries con vocabulario específico (cejas) y daña queries con sinonímia (skincare)
- La mejora global es modesta y no consistente entre dominios

## 24. Archivos creados/modificados
- **Creados**: `scripts/r5c3RerankingExperiment.js`, `r5c3_reranking_run_a.json`, `r5c3_reranking_run_b.json`
- **Modificados**: NINGUNO productivo

## 25. Tests
- **RAG: 69/69 PASS** | Global: **263 pass / 8 fail / 1 skip** (los 8 fallos pre-existentes prohibidos: biometric ×7, geminiFallback ×1). Cero fallos nuevos.

## 26. Riesgos
- El reranker léxico introduce regresiones en skincare — un reranker de producción podría necesitar más señales (semántica profunda, metadata)
- Confundir la mejora de cejas con una solución global sería un error: el dominio dominante (skincare) empeora
- Las 5 queries EMBEDDING/CORPUS LIMITATION no se resuelven con ranking de ningún tipo

## 27. Recomendación para R5-C4
1. **El reranking NO es la solución dominante**: solo 2/13 queries recuperables mejoran, y empeora skincare
2. **Prioridad real**: las 5-7 queries sin evidencia (skincare_007/010, cabello_002/004, cejas_003/004/008) requieren **corpus o embeddings**, no ranking
3. **Antes de invertir en un reranker neural**: resolver el ground truth (R5-C2 candidate → R@5 0.50) y evaluar discriminación del embedding con pares positivos/negativos
4. Si se persigue reranking: usar señales más ricas que lexical overlap (p.ej. cross-encoder), y validar específicamente que no degrade skincare
5. Cejas es el dominio con más upside de ranking (2 queries resueltas) pero 3 requieren corpus

## 28. VEREDICTO
**C — RERANKING PARCIAL**

El reranker heurístico demuestra que **E (ranking) es una causa REAL pero MINORITARIA**: 2/13 queries recuperables mejoran (cejas_002, cejas_005 → MRR 1.0), ΔMRR global +0.0667, y el dominio cejas salta de 0.119 a 0.333 MRR. Sin embargo: (a) no supera ningún quality gate, (b) degrada skincare (−0.0429 MRR), (c) 14/18 queries no cambian, y (d) 5-7 queries sin evidencia en top-20 son **EMBEDDING/CORPUS LIMITATION** que ningún reranker puede resolver. La conclusión causal: el problema residual es principalmente **retrieval/embedding/corpus (B)** con un componente **ranking (E)** secundario y dominio-específico. No se justifica un reranker como solución primaria; sí se justifica profundizar en corpus/embedding y, si acaso, un reranker neural validado contra regresiones de skincare.

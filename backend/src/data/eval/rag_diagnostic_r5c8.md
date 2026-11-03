# INFORME HERMES — CICLO 20
# R5-C8 — DECISIÓN CAUSAL PARA R5-C9

## 1. Estado Git
- **Branch**: `main` | **Commit**: `3c8df30d`
- **Nuevos**: `scripts/r5c8DecisionExperiment.js`, `r5c8_decision_experiment_a.json`, `r5c8_decision_experiment_b.json`, `rag_diagnostic_r5c8.md`
- Sin commits, sin cambios productivos.

## 2. Estado BD
- `beauty_db` LOCAL: **5,663 filas, 0 NULL, 1024d** — verificada por el script (SELECT) y manualmente. Intacta.

## 3. Estado corpus
- `corpus_canonico.json` v1.0.0: 5,619 chunks — no modificado

## 4. Estado dataset
- `evaluation_dataset_v2.json`: 18 VALID — no modificado | `baseline_real_r5b.json` intacto

## 5. Evidencia recuperada de R5-C7 (leída del archivo real, no de memoria)
- Coverage: FULL=10, PARTIAL=5, NO=3 | GT misaligned=8-9
- HNSW misses vs exact = **0** | Expected top-5: 10/65 (15.4%) | top-20: 22/65 (33.8%) = exact
- Veredicto R5-C7: CAUSA MIXTA con GROUND TRUTH dominante

## 6. Matriz causal 18 queries
| Grupo | n | Queries | Interpretación |
|---|---|---|---|
| G1: evidencia + HNSW top5 | 7 | skincare_003/005/006/008, cabello_006, cejas_001/005 | Retrieval satisfactorio |
| G2: HNSW top20 no top5 | 3 | skincare_009, cabello_008, cejas_007 | Ranking/profundidad |
| G3: exact sí, HNSW no | **0** | — | HNSW descartado |
| G4: ni exact top20 | 5 | skincare_007/010, cabello_002, cejas_004/008 | Embedding/query o GT incorrecto |
| G5: sin cobertura | 3 | cabello_004, cejas_002, cejas_003 | Corpus sin evidencia |

## 7. Corpus vs retrieval
- **7/18** retrieval correcto (G1) | **3/18** ranking contribuye (G2) | **0/18** HNSW | **3/18** corpus gap (G5)
- De G4 (5): **2 son GT misaligned** (skincare_010, cabello_002 — la evidencia E3 real SÍ se recupera en top-5, el expected es incorrecto); **3 son embedding/query reales** (skincare_007, cejas_004, cejas_008)

## 8. Ground truth vs retrieval
- **9/18 queries GT misaligned (50%)** — el retrieval recupera evidencia E3 correcta pero el expected del benchmark no la declara
- El motor NO falla en esas 9: falla la declaración de ground truth
- Retrieval/embedding real (sin GT): **3/18 (17%)** — skincare_007, cejas_004, cejas_008

## 9. Análisis CEJAS
| Query | Cov | Q0 MRR | Q2 MRR | Causa |
|---|---|---|---|---|
| cejas_001 | PART | 0.33 | 0.33 | GT misaligned |
| cejas_002 | NO | 0.00 | 0.25 | Corpus (parcialmente rescatable) |
| cejas_003 | NO | 0.00 | 0.00 | Corpus |
| cejas_004 | PART | 0.00 | **1.00** | Retrieval/formulación |
| cejas_005 | FULL | 0.50 | 0.00 | GT misaligned |
| cejas_007 | FULL | 0.00 | 0.33 | GT misaligned |
| cejas_008 | PART | 0.00 | **1.00** | Retrieval/formulación |

**Desglose del mal desempeño de cejas**: 2/7 corpus gap (002, 003), 3/7 GT misaligned (001, 005, 007), 2/7 retrieval con evidencia recuperable vía reformulación (004, 008). **No hay una única causa** — es distribución mixta.

## 10. Query representation
- Q2 (clarificación) global: MRR 0.2176 vs Q0 0.2222 → **~neutro/negativo**
- Mejoran 4 (todas cejas: 002, 004, 007, 008) | Empeoran 5 (skincare_003/005/006/008, cejas_005)
- **Query rewriting GLOBAL: DESCARTADO como prioridad**. Acotado a cejas_004/007/008: efecto grande (MRR 0→1.0) pero dominio-específico

## 11. HNSW vs exact
- **0 misses** en top-20 (R5-C7) → **HNSW DESCARTADO definitivamente**

## 12. Embedding discrimination
- Gap −0.0116 (R5-C5) — débil, pero **mezclado con GT desalineado**: los expected ausentes tienen sim 0.31-0.48 mientras la evidencia real recuperada tiene 0.53-0.64 (el embedding discrimina correctamente entre evidencia real y expected mal declarado)
- **NO AUTORIZAR cambio de modelo** — sin prueba controlada con modelo candidato (no disponible localmente)

## 13. Métricas experimentales [NO OFICIALES]
- Candidate GT (R5-C2): R@5=0.50, MRR=0.37 — [EXPERIMENTAL — NO OFICIAL]
- Q2 cejas: MRR 0.12→0.42 — [EXPERIMENTAL — NO OFICIAL]

## 14. Baseline oficial intacto
- P@1=0.1111 | P@3=0.2222 | P@5=0.1556 | R@5=0.1667 | MRR=0.2222 — **NO modificado**

## 15. Quality gates oficiales
P@5 ≥0.70: **FAIL (0.1556)** | R@5 ≥0.60: **FAIL (0.1667)** | MRR ≥0.65: **FAIL (0.2222)** | Top-K ≥0.50: FAIL | ContextP ≥0.70: FAIL — SIN MODIFICAR

## 16. Quality gates experimentales [NO OFICIALES]
- Candidate GT: R@5=0.50 → sigue **FAIL** vs 0.60 | MRR=0.37 → **FAIL** vs 0.65
- Ninguna configuración experimental supera gates

## 17. Clasificación causal
| Factor | Clasificación | Confianza |
|---|---|---|
| **GROUND TRUTH** | **CAUSA DOMINANTE (9/18, 50%)** | **ALTA** |
| **CORPUS** | **CAUSA SIGNIFICATIVA (3-4/18, 17-22%)** | **ALTA** |
| RETRIEVAL/EMBEDDING | CONTRIBUYENTE (3/18: skincare_007, cejas_004, cejas_008) | MEDIA |
| RANKING | CONTRIBUYENTE (3/18 G2) | MEDIA |
| QUERY FORMULATION | CONTRIBUYENTE acotada a cejas (4/18) | MEDIA |
| HNSW | DESCARTADA (0 misses) | ALTA |
| INFRAESTRUCTURA | DESCARTADA | ALTA |

## 18. Causa dominante
**GROUND TRUTH** — 9/18 queries (50%) con evidencia E3 recuperada por el retrieval pero expected incorrecto/no declarado. El motor funciona mejor de lo que el baseline sugiere.

## 19. Causas significativas
**CORPUS** — 3/18 sin evidencia genuina (cabello_004, cejas_002, cejas_003) + 1 parcial (skincare_007)

## 20. Causas contribuyentes
Retrieval/embedding (3/18), ranking (3/18), query formulation acotada a cejas (4/18)

## 21. Causas descartadas
HNSW (0 misses), threshold, chunking, truncado NVIDIA, reranking (R5-C3/C4), query rewriting global

## 22. Incertidumbres
- La distinción entre "retrieval falla" vs "GT incorrecto" en G4 depende del juicio semántico sobre la relevancia de los chunks recuperados (manual)
- Sin modelo de embedding candidato disponible, la hipótesis E no puede probarse comparativamente
- 18 queries = muestra pequeña

## 23. Riesgos
- Corregir el benchmark sin validación independiente puede introducir sesgo
- La reformulación de cejas en producción requiere capa de entrada no probada
- Marcar 3 queries UNSUPPORTED reduce la muestra a 15

## 24. Limitaciones
- Clasificación de cobertura basada en títulos top-20 + evidencia E0-E3
- Paráfrasis manuales
- El script R5-C8 es de consolidación (no ejecuta retrieval nuevo) — hereda la validez de R5-C6/C7

## 25. Archivos creados
- `scripts/r5c8DecisionExperiment.js`, `r5c8_decision_experiment_a.json`, `r5c8_decision_experiment_b.json`, `rag_diagnostic_r5c8.md`

## 26. Archivos modificados
- NINGUNO productivo

## 27. Cambios NO realizados
- Corpus, dataset, baseline, thresholds, modelo, HNSW, ragService, ragEvaluator: intactos
- Sin INSERT/UPDATE/DELETE (solo SELECT)

## 28. Tests
- **RAG: 69/69 PASS** | Global: **263 PASS / 8 FAIL / 1 SKIP** (los 8 pre-existentes prohibidos)
- Flaky geminiService/fase5: diagnosticados (abuse en Redis) y resueltos con limpieza — PASS aislados

## 29. Reproducibilidad
- **RUN A ≡ RUN B: matriz causal idéntica** (script determinista de consolidación + verificación BD)

## 30. Seguridad anti-producción
- Guarda activa en script (aborta si URL no es local)
- BD local 5,663/0 NULL/1024d verificada | Railway NO contactada

## 31. Decisión R5-C9
**OPCIÓN A + G — CORREGIR EL BENCHMARK OFICIAL, combinado con re-clasificación UNSUPPORTED**

| Opción | Decisión | Evidencia | Impacto esperado | Riesgo | Confianza |
|---|---|---|---|---|---|
| **A. Corregir benchmark** | **SÍ (prioridad 1)** | 9/18 GT misaligned; candidate R@5=0.50 sin tocar motor | R@5 0.17→0.50, MRR 0.22→0.37 [EXPERIMENTAL] | Bajo (solo benchmark) | **ALTA** |
| **G. Combinar: +UNSUPPORTED** | **SÍ (con A)** | 3/18 NO_COVERAGE verificados HNSW+exact+paráfrasis | Benchmark honesto; muestra 15 | Bajo | ALTA |
| B. Ampliar corpus | DIFERIDO | Solo 3/18 sin cobertura | — | Medio (coste) | MEDIA |
| C. Query rewriting | NO global / sí acotado cejas | Q2 MRR 0.218 vs 0.222; cejas_004/008 MRR 1.0 | MRR cejas +0.30 | Medio | MEDIA |
| D. Retrieval | NO | HNSW 0 misses; evidencia E3 recuperada | — | — | ALTA |
| E. Embeddings | NO AUTORIZAR | gap mezclado con GT; sin candidato | — | — | ALTA |
| F. HNSW | DESCARTADO | 0 misses vs exact | — | — | ALTA |
| H. No intervenir | NO | evidencia suficiente para A | — | — | ALTA |

**Próximo experimento recomendado (R5-C9)**: re-evaluación completa con el dataset corregido (expected re-mapeados con evidencia + 3 UNSUPPORTED) contra el MISMO motor — para medir el desempeño real del retrieval sin contaminación del benchmark.

## 32. VEREDICTO
**R5-C8 CERRADO — CAUSA SUFICIENTEMENTE AISLADA**

El cuello de botella REAL del sistema queda identificado con evidencia acumulada de 5 ciclos experimentales (R5-C3…C8):

**Causa dominante: GROUND TRUTH (50% de las queries)** — el retrieval recupera evidencia E3 correcta (verificado: pH limpiadores, restauración pH, niacinamida, autoinmunes/diabéticos en top-5) pero el expected oficial declara chunks incorrectos o inferiores. El motor RAG funciona mejor de lo que el baseline sugiere.

**Causa significativa: CORPUS (17%)** — 3 queries sin evidencia genuina (cabello_004 caída post-parto, cejas_003 visajismo por forma de cara, cejas_002 comparativa de técnicas).

**Causas contribuyentes**: retrieval/embedding (3/18), ranking (3/18), query formulation acotada a cejas (4/18).

**Descartadas con evidencia**: HNSW (0 misses), threshold, chunking, truncado, reranking, query rewriting global, cambio de embeddings sin prueba controlada.

**La cadena decisoria**: GROUND TRUTH → CORPUS → QUERY → RETRIEVAL → RANKING → EMBEDDING queda aislada: el siguiente paso (R5-C9) debe corregir el benchmark oficial y re-clasificar 3 UNSUPPORTED ANTES de cualquier intervención sobre el motor. No se autoriza cambio de embeddings, retrieval, HNSW ni query rewriting global con la evidencia actual.

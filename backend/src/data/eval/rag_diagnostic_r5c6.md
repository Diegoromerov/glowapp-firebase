# INFORME HERMES — CICLO 18
# R5-C6 — QUERY FORMULATION + CORPUS COVERAGE

## 1. Estado Git
- **Branch**: `main` | **Commit**: `3c8df30d`
- **Nuevos**: `scripts/r5c6QueryCorpusCoverageExperiment.js`, `r5c6_query_corpus_coverage_a.json`, `r5c6_query_corpus_coverage_b.json`, `r5c6_query_corpus_coverage_experiment.json`, `rag_diagnostic_r5c6.md`
- Sin commits, sin cambios productivos.

## 2. Estado BD
- `beauty_db` LOCAL: **5,663 filas, 0 NULL, 1024d** — intacta (solo SELECT + embeddings en memoria)

## 3. Seguridad anti-producción
- Guarda activa (aborta si URL no es localhost/127.0.0.1/0.0.0.0)
- Railway NO contactada

## 4. Estado corpus
- `corpus_canonico.json` v1.0.0: 5,619 chunks — no modificado

## 5. Estado dataset
- `evaluation_dataset_v2.json` v2.0: 18 VALID — no modificado
- `baseline_real_r5b.json` intacto

## 6. Metodología
- 18 queries × 3 variantes: Q0 (original), Q1 (paráfrasis), Q2 (clarificación de intención)
- Reformulaciones documentadas con rationale — derivadas SOLO de la intención, sin leakage (prohibido ver expected → fabricar query)
- Retrieval idéntico (mismo modelo, corpus, topK=10, sin threshold)
- Métricas en 2 capas: benchmark oficial (expected) + auditoría semántica (E0-E3)

## 7. Diseño Q0/Q1/Q2
- Q1: paráfrasis — conserva intención exacta con otra forma
- Q2: clarificación de intención — hace explícita la intención implícita SIN información nueva
- Ejemplo skincare_010: Q0 "Mejor limpiador para piel seca y sensible" → Q2 "¿Qué características debería tener un limpiador facial adecuado para piel seca y sensible, y qué ingredientes evitar?" (explícita selección, sin keywords de corpus)
- Las 18 con rationale guardado en el script

## 8. Auditoría de queries
- **18/18 clasificadas Q-A (bien formuladas)** — intención clara, sin ambigüedad, sin subespecificación
- El dataset fue construido con queries explícitas (categoría + dificultad + texto completo)

## 9. Auditoría de corpus
- Inspección semántica de los top-10 reales por query (títulos + similitud) — no keywords

## 10. Clasificación E0-E3
| Nivel | Queries | Detalle |
|---|---|---|
| **E3 fuerte** | 10 | skincare_003/005/006/008/009/010, cabello_002/008, cejas_005/007 |
| **E2 suficiente** | 2 | cabello_006, cejas_001 |
| **E1 parcial** | 3 | skincare_007, cejas_004, cejas_008 |
| **E0 sin evidencia** | 3 | **cabello_004, cejas_002, cejas_003** |

**Coverage E2/E3 = 12/18 = 66.7%**

## 11. Resultados Q0
- P@1=0.1111 | P@3=0.2037 | P@5=0.1222 | R@5=0.1667 | MRR=0.2222 (idéntico al baseline — validación del experimento)

## 12. Resultados Q1
- P@1=0.1667 | P@3=0.0926 | P@5=0.0667 | R@5=0.1139 | MRR=0.1991 (**peor que Q0**)

## 13. Resultados Q2
- P@1=0.1667 | P@3=0.1111 | P@5=0.0778 | R@5=0.1694 | MRR=0.2176 (≈Q0, sin mejora)

## 14. Comparación P@5/R@5/MRR
| Config | P@5 | R@5 | MRR |
|---|---|---|---|
| Q0 Original | 0.1222 | 0.1667 | 0.2222 |
| Q1 Paráfrasis | 0.0667 | 0.1139 | 0.1991 |
| Q2 Clarificación | 0.0778 | 0.1694 | 0.2176 |
| ΔQ1−Q0 | −0.0555 | −0.0528 | −0.0231 |
| ΔQ2−Q0 | −0.0444 | +0.0027 | −0.0046 |

**La reformulación NO mejora el retrieval globalmente.** Q1 empeora; Q2 es neutra.

## 15. Resultados por dominio
| Dominio | Coverage E2/E3 | Q0 MRR | Q1 MRR | Q2 MRR |
|---|---|---|---|---|
| skincare (7) | 6/7 (86%) | 0.3095 | 0.1429 | 0.0714 |
| cabello (4) | 3/4 (75%) | 0.2500 | 0.2500 | 0.2500 |
| cejas (7) | 3/7 (43%) | 0.1190 | 0.2262 | 0.4167 |

**Cejas tiene el peor coverage (43%) pero la MAYOR mejora por reformulación** (Q2 MRR 0.12→0.42). Skincare tiene buen coverage pero la reformulación lo daña.

## 16. Análisis cejas
| Query | Evidencia | Q0→Q2 MRR | Causa |
|---|---|---|---|
| cejas_001 | E2 | 0.33→0.33 | GROUND_TRUTH (expected es envejecimiento, no definición/duración) |
| cejas_002 | **E0** | 0→0.25 | CORPUS GAP (no existe comparativa de técnicas) — Q2 rescata parcial |
| cejas_003 | **E0** | 0→0 | CORPUS GAP (no existe visajismo por forma de cara) |
| cejas_004 | E1 | 0→**1.0** | RETRIEVAL — Q2 "cómo corrige la micropigmentación la asimetría" recupera ptosis (0.54) |
| cejas_005 | E3 | 0.5→0 | GROUND_TRUTH (Q2 desplaza expected cicatrización) |
| cejas_007 | E3 | 0→0.33 | RETRIEVAL — Q2 "condiciones de salud" recupera autoinmunes (0.59) |
| cejas_008 | E1 | 0→**1.0** | RETRIEVAL — Q2 "métodos para eliminar microblading mal ejecutado" recupera láser |

**Hallazgo clave**: 3 queries de cejas (004, 007, 008) SÍ tienen evidencia en corpus que el retrieval no recupera con Q0 — la reformulación las rescata. Son casos de formulación + ranking, no corpus-gap puro.

## 17. Análisis cabello
| Query | Evidencia | Q0 MRR | Causa |
|---|---|---|---|
| cabello_002 | E3 | 0 | GROUND_TRUTH (evidencia de restauración pH recuperada, expected es SERS diagnóstico) |
| cabello_004 | **E0** | 0 | CORPUS GAP (nada sobre caída post-parto/estrés — ni Q1/Q2 recuperan) |
| cabello_006 | E2 | 1.0 | Funciona (microbiota) |
| cabello_008 | E3 | 0 | GROUND_TRUTH (evidencia de oclusivos/humectantes recuperada, expected es bioimpedancia) |

## 18. Queries CORPUS-GAP (las 5 de R5-C2 re-verificadas)
| Query | Verificación R5-C6 | Verdict |
|---|---|---|
| cabello_004 | E0 — nada en top-10 ni con Q1/Q2 | **CONFIRMADO corpus-gap** |
| cejas_002 | E0 con Q0, pero Q1/Q2 recuperan parcial (MRR 0.25) | **CORPUS DÉBIL + formulación ayuda** |
| cejas_003 | E0 — nada ni con Q1/Q2 | **CONFIRMADO corpus-gap** |
| cejas_004 | E1 con Q0 → **E3 con Q2 (MRR 1.0)** | **NO es corpus-gap: era retrieval/formulación** |
| cejas_008 | E1 con Q0 → **E3 con Q2 (MRR 1.0)** | **NO es corpus-gap: era retrieval/formulación** |

**Revisión importante**: 2 de las 5 "corpus-gap" de R5-C2 (cejas_004, cejas_008) NO eran corpus-gap — la evidencia existe y la clarificación de intención la recupera. Solo 3 (cabello_004, cejas_002, cejas_003) son corpus-gap genuinos (y cejas_002 parcialmente recuperable).

## 19. Ground truth alignment
- 8/18 queries con evidencia E3 recuperada que NO coincide con el expected → **GROUND_TRUTH desalineado** (skincare_003/005/006/009/010, cabello_002/008, cejas_001)
- Confirmación independiente del hallazgo R5-C2: el benchmark oficial es la causa dominante

## 20. Corpus coverage
- Global: **E2/E3 = 66.7%** (12/18)
- Skincare: 86% | Cabello: 75% | Cejas: 43%
- 3/18 (16.7%) sin evidencia genuina: cabello_004, cejas_002, cejas_003

## 21. Cambios Δ por query
- **Q1**: mejoran 3 (cejas_002, cejas_004, cejas_007), empeoran 5 (skincare_003/005/006, cejas_001, cejas_005)
- **Q2**: mejoran 4 (cejas_002, cejas_004, cejas_007, cejas_008), empeoran 5 (skincare_003/005/006/008, cejas_005)
- **Patrón**: la reformulación ayuda SOLO en cejas (donde el corpus tiene evidencia mal posicionada) y daña skincare (donde el expected ya estaba cerca del top-1)

## 22. Reproducibilidad
- **RUN A ≡ RUN B: 18/18 queries idénticas** — determinista

## 23. Clasificación causal
| Factor | Clasificación | Confianza |
|---|---|---|
| **GROUND TRUTH** | **CAUSA DOMINANTE** (8/18 queries con evidencia E3 recuperada pero expected incorrecto) | **ALTA** |
| **CORPUS COVERAGE** | **CAUSA SIGNIFICATIVA** (3/18 E0 genuino; coverage 66.7%; cejas 43%) | **ALTA** |
| **RETRIEVAL** | CONTRIBUYE (3/18: cejas_004/007/008 con evidencia E1-E3 mal posicionada que la reformulación rescata) | MEDIA |
| **QUERY FORMULATION** | CONTRIBUYE PERO DOMINIO-ESPECÍFICA (rescata 3-4 de cejas, daña skincare; globalmente neutra/negativa) | MEDIA |
| EMBEDDING | CONTRIBUYE (gap −0.0116 de R5-C5, banda comprimida) | MEDIA |
| RANKING | CONTRIBUYE (evidencia en rank 2-5) | MEDIA |
| INFRAESTRUCTURA | DESCARTADA (HNSW marginal, threshold descartado) | ALTA |

## 24. Hipótesis confirmadas
- **GROUND TRUTH dominante** — 8/18 queries: el motor recupera evidencia correcta (E3) pero el expected del benchmark no la declara
- **CORPUS insuficiente en 3/18** (16.7%) — cabello_004, cejas_002 (parcial), cejas_003
- **La formulación SÍ importa en cejas** — clarificación de intención recupera evidencia que Q0 no alcanza (004, 007, 008)

## 25. Hipótesis descartadas
- **QUERY FORMULATION como causa global**: DESCARTADA — Q1/Q2 no mejoran las métricas globales (MRR 0.199/0.218 vs 0.222); la reformulación es dominio-específica de cejas
- **Las 5 "corpus-gap" de R5-C2**: 2 de 5 (cejas_004, cejas_008) REFUTADAS como corpus-gap — son retrieval/formulación

## 26. Limitaciones
- Reformulaciones manuales (auditables pero no automáticas)
- Clasificación E0-E3 es juicio semántico sobre títulos top-10 (no lectura completa de contenido)
- 18 queries = muestra pequeña; los porcentajes tienen incertidumbre
- La mejora de cejas con Q2 no se generaliza — no hay reformulación automática autorizada

## 27. Riesgos
- Confundir "Q2 mejora cejas" con "el sistema mejoraría con query expansion automática" — la reformulación manual no es implementable directamente
- Los gates siguen FAIL en TODAS las configuraciones (ninguna supera 0.70/0.60/0.65)

## 28. Cambios realizados
- **Creados**: script r5c6 (read-only) + 3 JSONs + este informe
- **Redis local**: claves `abuse:*` limpiadas de nuevo (auto-bloqueo de tests, no datos RAG)

## 29. Cambios NO realizados
- NINGUNO productivo: corpus, dataset, baseline, thresholds, modelo, HNSW, ragService, ragEvaluator intactos

## 30. Tests
- **RAG: 69/69 PASS** (con ciRagEvaluation verificado aislado 8/8 tras fallo transitorio en paralelo)
- **Global: 263 PASS / 8 FAIL / 1 SKIP** — solo los 4 pre-existentes prohibidos

## 31. Recomendación R5-C7
1. **Corregir el ground truth del dataset oficial** (prioridad máxima, evidencia acumulada en R5-C2 + R5-C6): 8/18 queries tienen evidencia E3 recuperada que el expected no declara. Impacto esperado: R@5 ~0.50 sin tocar el motor.
2. **Re-clasificar 3 queries como UNSUPPORTED** (cabello_004, cejas_003, cejas_002-parcial) — corpus gap genuino.
3. **Para cejas_004/007/008**: la evidencia existe pero el retrieval la posiciona mal con Q0 — candidatas a reformulación de query en producción (capa de formulación, no reranking) o a revisión de su chunking/embeddings.
4. **NO cambiar el modelo de embeddings** — la evidencia sigue sin justificarlo.
5. Re-evaluar con el dataset corregido antes de cualquier decisión de motor.

## 32. VEREDICTO
**CAUSA MIXTA** — con la siguiente composición de evidencia:

**GROUND TRUTH DOMINANTE** (confianza ALTA): 8/18 queries donde el retrieval recupera evidencia E3 correcta pero el expected del benchmark no la declara — el motor funciona mejor de lo que el baseline sugiere.

**CORPUS COVERAGE SIGNIFICATIVA** (confianza ALTA): coverage E2/E3 = 66.7%; 3/18 queries sin evidencia genuina (cabello_004, cejas_003, cejas_002-parcial); cejas es el dominio más pobre (43%).

**RETRIEVAL/FORMULACIÓN CONTRIBUYENTES** (confianza MEDIA): 3/18 queries de cejas (004, 007, 008) tienen evidencia que Q0 no recupera pero Q2 sí — la formulación de la query y el posicionamiento son el cuello de botella en esos casos específicos.

**Respuesta a la pregunta central**: expresar la misma intención de forma más clara (Q1/Q2) NO mejora el retrieval globalmente (MRR 0.199-0.218 vs 0.222) — la formulación NO es la causa dominante. Cuando el corpus SÍ contiene evidencia (12/18), el retrieval la recupera en el top-10 en la mayoría de los casos; el fallo principal es que el **ground truth no la declara** (8/18). Cuando el corpus NO contiene evidencia (3/18), ninguna formulación ayuda (demostrado: Q0/Q1/Q2 idénticas en cabello_004, cejas_003). Existe un subconjunto específico de cejas (004/007/008) donde la evidencia existe pero está mal posicionada y la clarificación de intención la rescata — un problema de formulación+ranking acotado a ese dominio, no general.

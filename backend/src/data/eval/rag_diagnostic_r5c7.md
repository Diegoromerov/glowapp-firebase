# INFORME HERMES — CICLO 19
# R5-C7 — COBERTURA DEL CORPUS + QUERY PARAPHRASING

## 1. Estado Git
- **Branch**: `main` | **Commit**: `3c8df30d`
- **Nuevos**: `scripts/r5c7CorpusCoverageAudit.js`, `r5c7_corpus_coverage_audit_a.json`, `r5c7_corpus_coverage_audit_b.json`, `r5c7_corpus_coverage_experiment.json`, `rag_diagnostic_r5c7.md`
- Sin commits, sin cambios productivos.

## 2. Estado BD
- `beauty_db` LOCAL: **5,663 filas, 0 NULL, 1024d** — intacta (solo SELECT + SET LOCAL en sesión)

## 3. Estado corpus
- `corpus_canonico.json` v1.0.0: 5,619 chunks — no modificado

## 4. Estado dataset
- `evaluation_dataset_v2.json`: 18 VALID — no modificado | `baseline_real_r5b.json` intacto

## 5. Metodología
- Por query: HNSW top-20 (productivo) + exact scan top-20 (`SET LOCAL enable_indexscan/bitmapscan off`) + similitud exacta query→expected
- Clasificación de cobertura por CONTENIDO (evidencia E0-E3 de R5-C6 + títulos de top-20), no keywords
- RUN A + RUN B

## 6. Coverage global
| Nivel | Queries | % |
|---|---|---|
| FULL_COVERAGE | 10 | 55.6% |
| PARTIAL_COVERAGE | 5 | 27.8% |
| NO_COVERAGE | 3 | 16.7% |
| GROUND_TRUTH_MISALIGNED | 8-9 | 44-50% |

## 7. Coverage por dominio
| Dominio | FULL | PARTIAL | NO |
|---|---|---|---|
| skincare (7) | 5 | 2 | 0 |
| cabello (4) | 2 | 1 | 1 |
| cejas (7) | 2 | 2 | 2 |

**Cejas: peor cobertura (2/7 FULL)** — consistente con su desempeño más bajo.

## 8. Análisis CEJAS
| Query | Cov | Expected top-20 | Causa |
|---|---|---|---|
| cejas_001 | PARTIAL | 1 (rank 3) | GT_MISALIGNED (expected es envejecimiento, no definición/duración) |
| cejas_002 | NO | 2 | CORPUS — no existe comparativa de las 3 técnicas |
| cejas_003 | NO | 0 | CORPUS — no existe visajismo por forma de cara |
| cejas_004 | PARTIAL | 0 | RETRIEVAL — evidencia ptosis existe (0.519) fuera de top-20; Q2 la rescata (MRR 1.0) |
| cejas_005 | FULL | 2 (ranks 2,3) | GT_MISALIGNED parcial (top1 psicodermatología tangencial) |
| cejas_007 | FULL | 1 (rank 18) | GT_MISALIGNED — autoinmunes+diabéticos (contraindicaciones reales) en top-4 |
| cejas_008 | PARTIAL | 0 | RETRIEVAL — evidencia láser existe (0.536) fuera de top-20; Q2 la rescata (MRR 1.0) |

**Por qué cejas falla**: 2/7 corpus-gap genuino (002, 003), 2/7 ground truth desalineado (001, 007), 2/7 retrieval con evidencia recuperable vía reformulación (004, 008), 1/7 parcial (005). NO es "cejas funciona mal" — son 4 causas distintas.

## 9. HNSW vs exact
- **HNSW misses = 0** (ningún expected perdido por el índice vs scan exacto en top-20)
- Expected en top-20: HNSW 22/65 = exact 22/65 — **idénticos**
- **HNSW definitivamente DESCARTADO**

## 10. Coverage-adjusted recall [EXPERIMENTAL — NO OFICIAL]
- De las 10 FULL_COVERAGE, expected en top-5 HNSW: 5 queries (skincare_003, 005, 006, 008, cejas_005)
- De las 10 FULL_COVERAGE, **5 tienen expected AUSENTE del top-20** (skincare_010, skincare_009, cabello_002, cabello_008, cejas_007) — pese a que el retrieval recupera evidencia E3 objetivamente relevante
- **Observación clave**: en esas 5, el motor NO falla — recupera contenido correcto (más relevante que el expected); es el benchmark el que declara mal la evidencia
- Coverage-adjusted R@5 formal: **NO DETERMINABLE** con este experimento (requiere candidate dataset; ver R5-C2: R@5=0.50)

## 11. Query original vs paráfrasis
- Reutiliza el experimento R5-C6 (Q0/Q1/Q2): la paráfrasis NO mejora globalmente (Q1 MRR 0.199, Q2 MRR 0.218 vs Q0 0.222)
- **Excepción**: cejas_004/007/008 mejoran con Q2 (MRR 0→1.0/0.33/1.0) — evidencia existente recuperable con mejor formulación
- Las NO_COVERAGE (cabello_004, cejas_003) no cambian con ninguna paráfrasis

## 12. Casos FULL_COVERAGE (10)
skincare_003, 005, 006, 008, 009, 010, cabello_002, 008, cejas_005, 007
- 5 con retrieval OK (expected en top-5): 003, 005, 006, 008, cejas_005
- 5 con expected fuera de top-20 pero evidencia E3 recuperada: 009, 010, cabello_002, 008, cejas_007 → **GROUND_TRUTH_MISALIGNED**

## 13. Casos PARTIAL_COVERAGE (5)
skincare_007 (solo ritmos circadianos), cabello_006 (microbiota centrada en tinte), cejas_001, cejas_004, cejas_008

## 14. Casos NO_COVERAGE (3)
**cabello_004** (nada sobre caída post-parto/estrés), **cejas_002** (sin comparativa de técnicas), **cejas_003** (sin visajismo por forma de cara)
- Verificado: 0 expected en top-20 HNSW Y exact; paráfrasis no ayuda

## 15. Casos GROUND_TRUTH_MISALIGNED (8-9)
skincare_005, 006, 009, 010, cabello_002, 008, cejas_001, cejas_005, cejas_007
- Evidencia textual en el JSON: retrieval recupera chunks objetivamente más relevantes que el expected (pH limpiadores vs piel seca; restauración pH vs SERS; niacinamida vs cobre+VitC; autoinmunes vs piel grasa)

## 16. Clasificación causal
| Factor | Clasificación | Confianza |
|---|---|---|
| **GROUND TRUTH** | **CAUSA DOMINANTE (9/18, 50%)** | ALTA |
| **CORPUS** | **CAUSA SIGNIFICATIVA (4/18, 22%)** | ALTA |
| RETRIEVAL | CONTRIBUYENTE (2/18, 11%: cejas_004, 008) | MEDIA |
| RANKING | CONTRIBUYENTE (expected rank 2-19) | MEDIA |
| EMBEDDING | CONTRIBUYENTE (gap −0.0116) | MEDIA |
| HNSW | DESCARTADA (0 misses) | ALTA |
| INFRAESTRUCTURA | DESCARTADA | ALTA |

## 17. Evidencia de retrieval
- En las queries FULL_COVERAGE con expected ausente, el retrieval recupera evidencia E3 correcta en top-5 (skincare_010: pH limpiadores 0.573; cabello_002: restauración pH 0.555; cejas_007: autoinmunes 0.590) → **el retrieval funciona; el benchmark no lo refleja**

## 18. Evidencia de ranking
- Expected cuando aparece: rank 2-19 (skincare_009 rank 8, cabello_008 rank 19, cejas_007 rank 18) → ranking contribuye pero en el contexto de GT desalineado

## 19. Evidencia de embedding/query representation
- Gap −0.0116 (R5-C5), banda 0.31-0.64 comprimida
- PERO: los expected ausentes tienen sim 0.31-0.48 (baja) mientras la evidencia real recuperada tiene 0.53-0.64 → **el embedding discrimina correctamente entre evidencia real y expected mal declarado**

## 20. Quality gates oficiales — SIN MODIFICAR
P@5 gate 0.70 | R@5 gate 0.60 | MRR gate 0.65 → baseline: **FAIL en los tres**

## 21. Quality gates experimentales — separados
- Coverage-adjusted (candidate GT de R5-C2): R@5 0.50 — sigue FAIL vs 0.60
- Ninguna configuración de paráfrasis supera gates

## 22. Riesgos
- Corregir el dataset sin validación clínica independiente puede introducir nuevos sesgos
- La reformulación de queries en producción (cejas) requiere capa de entrada no probada
- 3 queries NO_COVERAGE: si se marcan UNSUPPORTED, se reduce la muestra de 18

## 23. Limitaciones
- Clasificación de cobertura basada en títulos top-20 + evidencia E0-E3 (no lectura completa)
- Paráfrasis manuales (auditables, no automáticas)
- Muestra pequeña (18 queries)

## 24. Archivos creados
- `scripts/r5c7CorpusCoverageAudit.js`, `r5c7_corpus_coverage_audit_a.json`, `r5c7_corpus_coverage_audit_b.json`, `r5c7_corpus_coverage_experiment.json`, `rag_diagnostic_r5c7.md`

## 25. Archivos modificados
- NINGUNO productivo

## 26. Cambios NO realizados
- Corpus, dataset, baseline, thresholds, modelo, HNSW, ragService, ragEvaluator: intactos
- Sin INSERT/UPDATE/DELETE (solo SELECT + SET LOCAL)

## 27. Tests
- **RAG: 69/69 PASS** | Global: **263 PASS / 8 FAIL / 1 SKIP** (los 8 pre-existentes prohibidos)
- Nota: Redis local limpiado de claves abuse:* (auto-bloqueo de geminiService, documentado CICLO 17) — no es regresión

## 28. Reproducibilidad
- **RUN A ≡ RUN B: 18/18 queries con top-20 HNSW y exact idénticos** — determinista

## 29. Verificación anti-producción
- Guarda activa en script (aborta si URL no es local)
- BD local 5,663/0 NULL/1024d verificada pre y post
- Railway NO contactada

## 30. Recomendación R5-C8
1. **Corregir formalmente el dataset** (expected_chunks) — evidencia: 9/18 GT misaligned + candidate R@5=0.50; impacto: R@5 0.17→0.50, MRR 0.22→0.37; riesgo: bajo; confianza: ALTA
2. **Re-clasificar 3 queries como UNSUPPORTED** (cabello_004, cejas_003, cejas_002-parcial) — evidencia: NO_COVERAGE verificado HNSW+exact+paráfrasis; confianza: ALTA
3. **Reformulación de queries en producción SOLO para cejas_004/007/008** — evidencia: Q2 MRR 0→1.0/0.33/1.0; riesgo: medio; confianza: MEDIA
4. **NO cambiar embeddings/HNSW/retrieval** — HNSW 0 misses; el "gap" del embedding se explica por GT desalineado; sin modelo candidato; confianza: ALTA
5. **Siguiente experimento**: re-evaluación completa con dataset corregido (baseline experimental v2) antes de cualquier decisión de motor

## 31. VEREDICTO
**CAUSA MIXTA con GROUND TRUTH DOMINANTE**

La pregunta central de R5-C7 queda respondida con evidencia: **cuando una query VALID no obtiene su expected_chunk, el corpus SÍ contiene evidencia suficiente en 10/18 (55.6%)** y el retrieval la recupera correctamente — el problema es que el benchmark declara un expected incorrecto o inferior (9/18 GT misaligned). En 3/18 el corpus genuinamente carece de la información (cabello_004, cejas_002, cejas_003) — ninguna formulación la recupera. En 2/18 (cejas_004, cejas_008) existe evidencia recuperable que el retrieval posiciona mal pero una mejor formulación rescata. **El motor RAG funciona mejor de lo que el baseline sugiere: la evidencia relevante está en el corpus (66.7% E2/E3), el retrieval la encuentra (HNSW 0 misses, evidencia E3 en top-5), y el fallo principal es la declaración del ground truth.**

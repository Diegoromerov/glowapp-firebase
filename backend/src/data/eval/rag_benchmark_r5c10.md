# INFORME HERMES — CICLO 22
# R5-C10 — BENCHMARK V3: GROUND TRUTH FORMAL + UNSUPPORTED

## 1. Estado Git
- **Branch**: `main` | **Commit**: `3c8df30d`
- **Nuevos**: `scripts/buildDatasetV3Candidate.js`, `evaluation_dataset_v3_candidate.json`, `rag_benchmark_r5c10.md`
- Sin commits, sin cambios productivos.

## 2. Estado BD
- `beauty_db` LOCAL: **5,663 filas, 0 NULL, 1024d** — verificada. Intacta (solo SELECT).

## 3. Estado corpus
- `corpus_canonico.json` v1.0.0: 5,619 chunks — no modificado

## 4. Estado dataset
- `evaluation_dataset_v2.json`: **NO modificado** (18 VALID / 12 UNSUPPORTED / 0 INVALID intactos)
- `baseline_real_r5b.json`: intacto
- **Nuevo artefacto CANDIDATO**: `evaluation_dataset_v3_candidate.json` (NO es benchmark oficial)

## 5. Seguridad de BD
- Conexión: `postgresql://admin@localhost:5435/beauty_db` (LOCAL, Docker)
- Guarda anti-producción activa en el script (aborta si no es localhost/127.0.0.1/0.0.0.0)
- Solo SELECT de verificación de IDs. Railway NO contactada.

## 6. Fuentes de verdad utilizadas
| Fuente | Uso |
|---|---|
| `evaluation_dataset_v2.json` | 18 queries VALID base |
| `r5c2_alignment_candidate.json` | Alignment status + candidate chunks (R5-C2) |
| `r5c7_corpus_coverage_audit_a.json` | Top-20 retrieval REAL por query (chunk_ids completos) |
| `rag_diagnostic_r5c9.md` | Clasificación causal consolidada |
| Informes R5-C6/C7 | Coverage E0-E3, root causes, paráfrasis |

## 7. Clasificación formal (A-F)
| Categoría | n | Queries |
|---|---|---|
| **A — SUPPORTED/ALIGNED** | 2 | skincare_003, skincare_008 |
| **B — SUPPORTED/MISALIGNED** | 10 | skincare_005/006/009/010, cabello_002/008, cejas_004/005/007/008 |
| **C — SUPPORTED/MULTI-CHUNK** | 0 | — (ninguna requiere combinación forzosa) |
| **D — PARTIALLY_SUPPORTED** | 3 | skincare_007, cabello_006, cejas_001 |
| **E — UNSUPPORTED** | 3 | cabello_004, cejas_002, cejas_003 |
| **F — AMBIGUOUS** | 0 | — |

**Verificación anti-confusión UNSUPPORTED vs NOT_RETRIEVED**:
- cabello_004 (caída post-parto/estrés): búsqueda exhaustiva — **ningún chunk del corpus trata el tema** (E0 verificado en HNSW top-20 + exact scan + paráfrasis Q1/Q2) → **UNSUPPORTED legítimo**
- cejas_002 (comparativa de técnicas): solo hay chunks aislados de cada técnica, **ninguno comparativo** → UNSUPPORTED
- cejas_003 (forma ideal para cara redonda): **ningún chunk de visajismo por forma de rostro** → UNSUPPORTED
- Contrasta con skincare_010 (limpiador piel seca): el corpus SÍ tiene "pH de limpiadores" — es SUPPORTED con expected mal declarado en v2

## 8. Expected chunks v3 (primary/supporting)
- Esquema: `expected_chunks: { primary: [...], supporting: [...] }`
- 31 IDs totales (primary + supporting) — **31/31 verificados presentes en BD**
- `allow_better_evidence: true` en SUPPORTED (no penalizar retrieval que encuentra evidencia mejor)
- Rationale/nota por query (en el JSON)

## 9. ⚠️ LIMITACIÓN METODOLÓGICA CRÍTICA (honestidad)
**La validación métrica del v3 tiene sesgo de selección circular**: los expected v3 fueron elegidos de los top-20 que el propio retrieval recuperó en R5-C7 (los IDs reales se extrajeron del audit). Por tanto:

- **R@5 = 1.0000 [EXPERIMENTAL] NO es evidencia de mejora del motor** — es el artefacto de haber seleccionado la evidencia del ranking observado
- La única medida NO contaminada del potencial del motor es el **candidate R5-C2** (construido con matching léxico independiente del retrieval): **R@5 ≈ 0.50, MRR ≈ 0.37**
- El v3 candidato es válido como **propuesta de estructura y clasificación** (status, primary/supporting, rationale), pero su validación numérica requiere expected seleccionados INDEPENDIENTEMENTE del retrieval

**Recomendación**: antes de usar v3 como benchmark, re-validar cada expected con un humano/revisor independiente (o con búsqueda léxica de corpus completo, no top-K) para eliminar el sesgo circular.

## 10. Métricas [EXPERIMENTAL — NO OFICIAL, con sesgo declarado]
| Métrica | Baseline oficial v2 (18) | V3 con sesgo (15 supported) | Candidate R5-C2 (sin sesgo) |
|---|---|---|---|
| P@1 | 0.1111 | 0.4667 | — |
| P@3 | 0.2222 | 0.6444 | — |
| P@5 | 0.1556 | 0.4400 | — |
| R@5 | 0.1667 | 1.0000 ⚠️ | ≈ 0.50 |
| MRR | 0.2222 | 0.7222 ⚠️ | ≈ 0.37 |

**Interpretación correcta**: el motor NO es perfecto (candidate sin sesgo: MRR 0.37). El v3 demuestra que la ESTRUCTURA del benchmark puede corregirse, pero la VALIDACIÓN numérica final debe hacerse con expected validados independientemente.

## 11. Quality gates (sin modificar)
Oficiales: P@5 ≥0.70 FAIL | R@5 ≥0.60 FAIL (baseline 0.1667) | MRR ≥0.65 FAIL (0.2222)
Con candidate sin sesgo: R@5 0.50 → sigue FAIL vs 0.60 | MRR 0.37 → sigue FAIL vs 0.65

## 12. Tests
- RAG: **69/69 PASS** | Global: **263 PASS / 8 FAIL / 1 SKIP** (los 8 pre-existentes prohibidos)
- Sin fallos nuevos, sin flaky en la corrida final

## 13. Archivos creados/modificados
- **Creados**: `scripts/buildDatasetV3Candidate.js`, `evaluation_dataset_v3_candidate.json`, `rag_benchmark_r5c10.md`
- **Modificados**: NINGUNO productivo

## 14. Cambios NO realizados
- v2, baseline, corpus, embeddings, BD, ragService, migraciones, Railway: intactos
- No se ejecutó: ingestion, UPDATE/DELETE/INSERT, tuning

## 15. VEREDICTO
**R5-C10 COMPLETADO — BENCHMARK V3 CANDIDATO PRODUCIDO, con limitación metodológica declarada**

El ciclo produjo el artefacto solicitado: `evaluation_dataset_v3_candidate.json` con clasificación formal (2 SUPPORTED_ALIGNED, 10 SUPPORTED_MISALIGNED, 3 PARTIALLY_SUPPORTED, 3 UNSUPPORTED), expected primary/supporting con 31/31 IDs verificados en BD, y rationale por query. La clasificación UNSUPPORTED fue validada contra el principio "UNSUPPORTED ≠ NOT_RETRIEVED" (búsqueda exhaustiva, no resultado del retrieval).

**Hallazgo metodológico importante**: el sesgo de selección circular (expected derivados del ranking observado) invalida la interpretación de las métricas V3 como evidencia de mejora del motor (R@5=1.0 es artefacto). La medida honesta del potencial del motor sigue siendo el candidate R5-C2 (R@5≈0.50, MRR≈0.37).

**Recomendación R5-C11**: re-validar los expected del v3 con revisión independiente (humana o léxica de corpus completo) para eliminar el sesgo circular, y solo entonces declarar v3 como benchmark oficial. El motor no debe intervenirse todavía.

# INFORME HERMES — CICLO 30
# R5-C18 — A/B REPRESENTACIÓN DOCUMENTAL

## Estado Git
- **Branch**: `main` | **Commit**: `3c8df30d`
- **Nuevos**: `scripts/r5c18DocumentRepresentationAB.js`, `r5c18_document_representation_ab_a.json`, `r5c18_document_representation_ab_b.json`, `r5c18_document_representation_ab.json`, `rag_diagnostic_r5c18.md`
- Sin commits, sin cambios productivos.

## Estado BD
- 5,663 filas / 0 NULL / 1024d / 0 duplicados — intacta (solo SELECT + 487 embeddings B en memoria)

## Integridad GOLD-V5
- `evaluation_dataset_v5_candidate.json` — NO modificado; baseline R5-C intacto (R@5=0.7885, MRR=0.7179)

## Baseline oficial
- R@5=0.7885, MRR=0.7179 (referencia; no se sobrescribe)

## Diseño experimental
- **ARM A**: passage embedding = content (pipeline actual exacto) — embeddings BD, 0 llamadas nuevas
- **ARM B**: passage embedding = category + seccion + title + content (separador ` | `) — EN MEMORIA
- Constantes: query, modelo, GOLD-V5, K=10, cosine. Única variable: representación documental
- Pool: top-50 A + golds por query (cobertura acotada, documentada)
- Costo: 487 embeddings B, 2 errores (texto >512 tokens: skincare-rutinas-glicobiologia), delay 120ms

## ARM A
R@5=0.6267 | MRR=0.7222 | P@1=0.4667 | P@3=0.6667 | P@5=0.4667 (15 queries: 13 SUPPORTED + 2 PARTIAL)

## ARM B
R@5=0.4656 | MRR=0.6356 | P@1=0.4667 | P@3=0.4222 | P@5=0.3467

## Representación exacta utilizada
`category + ' | ' + seccion + ' | ' + title + ' | ' + content` (campos reales de BD/corpus)

## Queries evaluadas
15 (todas las SUPPORTED + PARTIALLY_SUPPORTED del GOLD-V5)

## Resultados globales
| Métrica | A | B | Δ |
|---|---|---|---|
| P@1 | 0.4667 | 0.4667 | 0.0000 |
| P@3 | 0.6667 | 0.4222 | **−0.2445** |
| P@5 | 0.4667 | 0.3467 | **−0.1200** |
| R@5 | 0.6267 | 0.4656 | **−0.1611** |
| MRR | 0.7222 | 0.6356 | **−0.0866** |

## Resultados por query
- **IMPROVED (2)**: cejas_001, cejas_007 (mejora de rank, no de recall)
- **REGRESSED (5)**: skincare_003, skincare_005, skincare_007, skincare_009, cejas_005
- **UNCHANGED (8)**: el resto, incluidos los 3 misses

## Los 3 misses
| Miss | A goldRank | B goldRank | A score | B score | Veredicto |
|---|---|---|---|---|---|
| cabello_002 | 1 | 1 | 0.5552 | 0.5591 | UNCHANGED |
| cejas_004 | 2 | 2 | 0.5238 | 0.5397 | UNCHANGED (R@5 empeora 0.5→0.33) |
| cejas_008 | 1 | 1 | 0.5916 | 0.6186 | UNCHANGED |

**0/3 misses recuperados.**

## Controles positivos
NO preservados: 5 regresiones incluyendo controles que funcionaban (skincare_003 R@5 0.75→0.50, skincare_007 0.67→0, cejas_005 0.50→0).

## Hard negatives
B no separa mejor gold vs competidores: **aumenta todas las similitudes del pool de forma no discriminativa**. La banda de colisión 0.50–0.59 se desplaza pero no se abre.

## Márgenes A vs B
Los gold scores suben en B (confirmando R5-C17: +0.004..+0.027) pero los competidores suben MÁS → el margen relativo empeora.

## RUN A vs RUN B
✅ **A ≡ B** — métricas idénticas en ambas corridas (reproducible)

## Coste/errores de embedding
487 llamadas NVIDIA (solo pool), 2 errores 400 (texto >512 tokens), delay 120ms, breaker NO abrió (1 fallo transitorio, recuperado).

## Tests
- **RAG**: 61/61 PASS (4 módulos: embeddingService, ragEvaluator, ragLogger, ragMetrics); ciRagEvaluation bloqueado por timeout de infraestructura (CPU 100%, documentado en CICLO 27-29, pasa 8/8 aislado cuando baja la carga)
- **Global**: 263 PASS / 8 FAIL / 1 SKIP (los 8 pre-existentes prohibidos)

## Integridad
BD intacta, corpus intacto, GOLD-V5 intacto, baseline intacto, Railway NO contactada.

## Riesgos
- El pool top-50 A acota la cobertura de B (documentado) — si un gold estuviera fuera del top-50 A, B no podría encontrarlo; no es el caso aquí
- La medida directa de similitud (R5-C17 EXP F) puede ser engañosa: mide solo el gold, no la separación relativa

## Veredicto
**HYPOTHESIS-DISCONFIRMED**

La hipótesis EMBEDDING-DOCUMENT (dominio+título+contenido mejora retrieval) NO se reproduce en el A/B completo: B empeora R@5 (−0.16), MRR (−0.09), P@3 (−0.24) y P@5 (−0.12), con 5 regresiones y 0/3 misses recuperados. El mecanismo causal: el prefijo de dominio infla la similitud de TODOS los chunks del mismo dominio (competidores incluidos), no solo del gold — aumenta similitudes absolutas, no discriminación relativa. El hallazgo de R5-C17 (similitud directa +0.04..+0.24) era una medida incompleta; el ranking completo revela que la separación relativa empeora.

## Recomendación R5-C19
1. **DESCARTAR** la variante dominio+título+contenido (evidencia negativa reproducible)
2. El cuello de botella real se mantiene en la **discriminación del embedding en la banda 0.50–0.59** (colisión semántica)
3. **A/B controlado de modelo de embeddings** (misma BD, mismo gold, mismas queries) — un modelo con mayor discriminación puede abrir la banda
4. Si se prueban representaciones más sutiles (título solo), el A/B debe medir RANKING completo, no similitud directa
5. GOLD-V5 y baseline R5-C intactos; los 3 misses permanecen

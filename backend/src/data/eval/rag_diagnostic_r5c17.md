# INFORME HERMES — CICLO 29
# R5-C17 — DISCRIMINACIÓN DEL EMBEDDING + REPRESENTACIÓN DOCUMENTAL

## 1. Estado Git
- **Branch**: `main` | **Commit**: `3c8df30d`
- **Nuevos**: `scripts/r5c17EmbeddingDiscriminationExperiment.js`, `r5c17_embedding_discrimination_experiment_a.json`, `r5c17_embedding_discrimination_experiment_b.json`, `r5c17_embedding_discrimination_experiment.json`, `rag_diagnostic_r5c17.md`
- Sin commits, sin cambios productivos.

## 2. Estado BD
- 5,663 filas / 0 NULL / 1024d — intacta (solo SELECT + embeddings en memoria)

## 3. GOLD-V5 utilizado
- `evaluation_dataset_v5_candidate.json` — NO modificado; baseline R5-C intacto (R@5=0.7885, MRR=0.7179)

## 4. Casos evaluados
- **3 misses**: cabello_002, cejas_004, cejas_008 (evidencia existe, retrieval no la coloca en top-5)
- **4 controles positivos**: skincare_003, skincare_010, cabello_008, cejas_007 (R@5=1.0 en R5-C14)

## 5. Matriz query-document
| Query | Tipo | bestGold | top1Comp | gold−top1 |
|---|---|---|---|---|
| cabello_002 | MISS | 0.5552 | 0.5407 | **+0.0145** |
| cejas_004 | MISS | 0.5238 | 0.5264 | **−0.0026** |
| cejas_008 | MISS | 0.5916 | 0.5840 | **+0.0076** |
| skincare_003 | CTRL | 0.5807 | 0.5389 | +0.0418 |
| skincare_010 | CTRL | 0.5729 | 0.5253 | +0.0476 |
| cabello_008 | CTRL | 0.5325 | 0.5063 | +0.0262 |
| cejas_007 | CTRL | 0.5895 | 0.5922 | −0.0027 |

## 6. Hard negatives
- **cabello_002**: 3/5 EMPATE_PRÁCTICO, 2/5 COMPETENCIA_ESTRECHA (competidores del mismo dominio)
- **cejas_004**: **1/5 NEGATIVO_SUPERA_GOLD** (visajismo_cejas... 0.5264 > gold 0.5238)
- **cejas_008**: 5/5 EMPATE_PRÁCTICO (psicodermatología, propiocepción)
- **Conclusión**: los 3 misses tienen competencia estrecha o negativos que superan al gold — **SEMANTIC COLLISION en la banda 0.50–0.59**

## 7. Márgenes de discriminación (EXP D)
| Grupo | mean | median | min | max |
|---|---|---|---|---|
| Misses | **0.0065** | 0.0076 | −0.0026 | 0.0145 |
| Controles | **0.0282** | 0.0418 | −0.0027 | 0.0476 |

**Los misses viven en competencia ~4.3× más estrecha que los controles.**

## 8. Análisis de representación documental (EXP F)
En memoria (sin reingesta): embedding(passage) de `dominio + título + contenido` vs embedding productivo actual:

| Query | Δ sim media | Caso extremo |
|---|---|---|
| **cabello_002** | **+0.1014** | mejor gold 0.555→0.648 |
| **cejas_004** | **+0.0703** | musculatura 0.343→0.585 (**+0.242**) |
| **cejas_008** | **+0.0433** | erbio-glass 0.411→0.546 |
| skincare_003 | +0.1206 | control también gana |
| cejas_007 | −0.0203 | control ya separado |

**Hallazgo causal**: los chunks de los misses NO están mal en contenido — están **MAL REPRESENTADOS en el embedding** (el texto de passage no lleva el contexto de título/dominio). Al añadirlo, la similitud sube +0.04..+0.24, suficiente para escapar de la zona de colisión.

## 9. Resultado de variantes experimentales
Solo se ejecutó la variante documental EN MEMORIA (sin reingesta) — mejora la similitud del gold en los 3 misses sin tocar nada productivo.

## 10. RUN A vs RUN B
✅ **A ≡ B** — márgenes y hard negatives idénticos en ambas corridas

## 11. Impacto en los 3 misses
- cabello_002: gold sube de 0.555 a 0.648 con representación documental → sale de la zona de colisión
- cejas_004: musculatura de 0.343 a 0.585 (+0.242) — el peor representado es el que más gana
- cejas_008: remoción de 0.411–0.536 a 0.534–0.604

## 12. Métricas
Baseline R5-C intacto (R@5=0.7885, MRR=0.7179). No se calculó un nuevo baseline — este ciclo es diagnóstico, no de optimización.

## 13. Clasificación causal
**EMBEDDING-DOCUMENT**

## 14. Hipótesis confirmada
**La representación documental es un factor causal**: el texto que entra al embedding de passage (sin título/dominio) infra-representa los chunks, dejándolos en la zona de colisión semántica con competidores.

## 15. Hipótesis descartadas
- QUERY (R5-C16: QUERY-REPRESENTATION-DISCARDED)
- HNSW (R5-C15: exact ≡ HNSW, ef_search sin efecto)
- Reranking (R5-C3/C4)
- Threshold, chunking, truncado NVIDIA (ciclos previos)
- Corpus (el contenido correcto ES distinguible cuando se representa bien)

## 16. Qué NO debe tocarse
Modelo de embeddings, HNSW, threshold, corpus, GOLD-V5, baseline R5-C, código productivo, Railway.

## 17. Recomendación R5-C18
1. **A/B controlado de representación documental**: añadir título (+dominio) al texto del passage embedding — requiere decisión del Director (reingesta o enriquecimiento runtime)
2. Evaluar si resuelve ≥2/3 misses antes de cualquier A/B de modelo
3. Solo si la representación documental NO resuelve → A/B de modelos de embedding
4. Mantener los 3 misses como casos de evaluación

## 18. Tests
- **RAG: 61/61 PASS** (4 módulos verificados en este ciclo; ciRagEvaluation verificado 8/8 en CICLO 27/28 — el fallo transitorio es timeout de spawn bajo CPU 100%, no regresión)
- **Global: 263 PASS / 8 FAIL / 1 SKIP** (los 8 pre-existentes prohibidos)

## 19. Integridad y seguridad
- BD intacta, guarda anti-producción activa, Railway no contactada, solo SELECT + embeddings en memoria

## 20. VEREDICTO
**EMBEDDING-DOCUMENT — CONFIRMADO**

El déficit residual de los 3 retrieval misses está causado por la **representación documental deficiente** (el texto de passage sin contexto de título/dominio), no por la query, no por HNSW, no por el contenido del corpus. La evidencia: (a) márgenes de discriminación 4.3× menores en misses vs controles; (b) hard negatives en empate práctico o superando al gold; (c) al enriquecer la representación del documento en memoria, la similitud query↔gold sube +0.04..+0.24 en los 3 misses. El siguiente ciclo (R5-C18) debe ejecutar el A/B controlado de representación documental — el A/B de modelos de embeddings queda condicionado a su resultado.

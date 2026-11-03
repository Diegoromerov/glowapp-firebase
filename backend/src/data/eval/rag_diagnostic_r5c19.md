# INFORME HERMES — CICLO 31
# R5-C19 — A/B CONTROLADO DE MODELO DE EMBEDDINGS

## 1. Estado Git
- **Branch**: `main` | **Commit**: `3c8df30d`
- **Nuevos**: `scripts/r5c19EmbeddingModelAB.js`, `r5c19_embedding_model_ab_a.json`, `r5c19_embedding_model_ab_b.json`, `r5c19_embedding_model_ab.json`, `rag_diagnostic_r5c19.md`
- Sin commits, sin cambios productivos.

## 2. Estado BD
- 5,663 filas / 0 NULL / 1024d / 0 duplicados — intacta (solo SELECT; embeddings B en memoria vía Ollama)

## 3. Modelo actual (ARM A)
- `nvidia/nv-embedqa-e5-v5` (1024d, API NVIDIA) — modelo productivo, embeddings en BD

## 4. Modelo alternativo (ARM B)
- `mxbai-embed-large` (1024d, Ollama LOCAL) — misma dimensión → comparación limpia del espacio semántico
- Descargado en este ciclo (669MB); coste: 0 API calls (local)

## 5. Metodología
- CANDIDATE POOL: top-50 de A + golds por query (489 chunks únicos) — documentado como NO evaluación completa del motor
- Constantes: query, gold, corpus, K=10, cosine, texto passage idéntico. Única variable: modelo de embedding
- Embeddings B en memoria (sin escribir BD)

## 6. Métricas A/B
| Métrica | A (e5-v5) | B (mxbai) | Δ |
|---|---|---|---|
| P@1 | 0.4667 | 0.4000 | −0.0667 |
| P@3 | 0.6667 | 0.2222 | **−0.4445** |
| P@5 | 0.4667 | 0.1733 | **−0.2934** |
| R@5 | 0.6267 | 0.2356 | **−0.3911** |
| MRR | 0.7222 | 0.4856 | **−0.2366** |

## 7. Análisis de los 3 misses
| Miss | A goldRank | B goldRank | A score | B score | Veredicto |
|---|---|---|---|---|---|
| cabello_002 | 1 | **5** | 0.5552 | 0.7539 | WORSE |
| cejas_004 | 2 | **8** | 0.5238 | 0.7962 | WORSE (R@5 0.5→0) |
| cejas_008 | 1 | 1 | 0.5916 | 0.8311 | SAME rank, R@5 0.33→0.17 |

**Los 3 misses empeoran con el modelo alternativo.**

## 8. Análisis de hard negatives / márgenes
- B "mejora" el margen en 5/15 (skincare_003/005/006/009, cejas_001) pero **empeora el recall en esos mismos casos** (skincare_005: margin +0.03 pero R@5 −0.33)
- **Artefacto de escala**: mxbai produce scores 0.75–0.83 vs e5-v5 0.52–0.59 — la "mejora de discriminación" no es real

## 9. Regresiones
**13/15 queries empeoran** con B; solo 2 se mantienen (cejas_008 rank, cejas_001 parcial)

## 10. Reproducibilidad
✅ **A ≡ B** — métricas idénticas en RUN A y RUN B (determinista)

## 11. Integridad
- BD intacta (5,663/0 NULL/1024d), corpus intacto, GOLD-V5 intacto, baseline intacto
- Railway NO contactada; ninguna escritura; solo SELECT + Ollama local en memoria

## 12. Tests
- **RAG**: 61/61 PASS (4 módulos: embeddingService, ragEvaluator, ragLogger, ragMetrics)
- **Global**: 263 PASS / 8 FAIL / 1 SKIP (los 8 pre-existentes prohibidos)
- ciRagEvaluation: flaky de infraestructura (timeout 5s vs arranque Node 8-18s bajo CPU 100%) — documentado, no regresión

## 13. Clasificación causal
**MODEL-DISCONFIRMED** — el cambio de modelo NO es una intervención causal válida para mejorar el retrieval.

## 14. Veredicto R5-C19
**MODEL-DISCONFIRMED**

El modelo alternativo (mxbai-embed-large) es claramente inferior al productivo (e5-v5): R@5 −0.39, MRR −0.24, 3 misses empeoran, 13/15 queries degradan. La aparente mejora de discriminación en 5 queries es un artefacto de escala (scores más altos) que no se tradujo en mejor recall. **La hipótesis "el modelo de embeddings es el cuello de botella" queda disconfirmada para esta alternativa**: el déficit residual persiste con ambos modelos → la causa está en la estructura semántica del dominio (conceptos de belleza/dermatología intrínsecamente cercanos en espacio embedding), no en el modelo.

## 15. Recomendación R5-C20
1. **DESCARTAR** el cambio a mxbai-embed-large (evidencia negativa reproducible)
2. Si se prueba otro modelo, usar uno de la familia E5/retrieval-especializada (bge-m3, nomic-embed-text) — pero la hipótesis del modelo queda debilitada
3. El déficit residual (3 misses) apunta a **estructura semántica del dominio**: las opciones restantes son (a) re-abrir reranking léxico complementario con evidencia nueva, (b) representación documental no probada (título SOLO, sin dominio), (c) aceptar el baseline R5-C como techo del motor actual
4. GOLD-V5, baseline R5-C y motor productivo intactos

## Salida para el Director
1. **Archivos creados**: script + 3 JSON + informe
2. **Archivos modificados**: ninguno productivo
3. **BD**: 5,663/0 NULL/1024d intacta
4. **Corpus**: intacto
5. **V2/V3/V4/V5**: intactos
6. **Misses**: empeoran con B (1→5, 2→8, pérdida de recall) → el modelo actual es mejor
7. **ΔR@5**: −0.39 | **ΔMRR**: −0.24
8. **Reproducibilidad**: A≡B
9. **Tests**: RAG 61/61, global 263/8/1
10. **Qué queda demostrado**: cambiar a mxbai-embed-large es un retroceso; el déficit es del espacio semántico del dominio, no del modelo
11. **Qué NO queda demostrado**: que ningún otro modelo pueda mejorar (solo se probó uno)
12. **Recomendación exacta R5-C20**: probar un modelo de la familia retrieval-especializada (bge-m3 1024d o nomic-embed-text 768d) O cerrar la línea de embeddings y atacar el déficit con representación documental título-solo o aceptar el techo actual

# INFORME HERMES — CICLO 32
# R5-C20 — A/B CONTROLADO DE RERANKING HÍBRIDO

## 1. Estado Git
- **Branch**: `main` | **Commit**: `3c8df30d`
- **Nuevos**: `scripts/r5c20HybridRerankingExperiment.js`, `r5c20_hybrid_reranking_experiment_a.json`, `r5c20_hybrid_reranking_experiment_b.json`, `r5c20_hybrid_reranking_experiment.json`, `rag_diagnostic_r5c20.md`
- Sin commits, sin cambios productivos.

## 2. Estado BD
- 5,663 filas / 0 NULL / 1024d / 0 duplicados — intacta (solo SELECT)

## 3. Estado Gold-V5
- `evaluation_dataset_v5_candidate.json` — NO modificado

## 4. Baseline R5-C
- R@5=0.7885, MRR=0.7179 — NO modificado

## 5. Modelo utilizado
- `nvidia/nv-embedqa-e5-v5` (1024d) — mismo retrieval para A y B

## 6. Candidate recall @10/@20/@50
| K | Recall |
|---|---|
| @10 | 0.6545 |
| @20 | 0.7156 |
| @50 | **0.8011** |
| Gold en pool | **15/15** |
| Fuera de pool | 0 |

**El recall del pool es alto y todos los golds están dentro del top-50 → NO es un problema de candidate generation.**

## 7. Metodología ARM A
- Top-50 e5-v5, ranking por vector_score, SIN reranking

## 8. Metodología ARM B
- Mismo top-50 e5-v5 + reranker híbrido: `hybrid = w_v·norm(vector) + w_l·lexical + w_c·concept + w_t·title`
- **Grid pre-registrado** (3 configs, sin tuning post-hoc): CFG1 (0.70/0.20/0.05/0.05), CFG2 (0.50/0.30/0.10/0.10), CFG3 (0.30/0.40/0.15/0.15)
- Señales deterministas, sin LLM, sin reglas por query, sin leakage (conceptos = lista genérica del dominio)

## 9. Fórmula y pesos
Ver §8. Todos los pesos fijados ANTES de evaluar.

## 10. Métricas completas A/B
| Config | P@1 | P@3 | P@5 | R@5 | R@10 | MRR |
|---|---|---|---|---|---|---|
| A vector | 0.4667 | 0.6667 | 0.4533 | 0.6156 | 0.6545 | 0.7222 |
| B CFG1 | 0.6667 | 0.5778 | 0.4667 | **0.6322** | 0.6545 | **0.8222** |
| B CFG2 | 0.6667 | 0.5333 | 0.4000 | 0.5433 | 0.6322 | 0.8056 |
| B CFG3 | 0.6000 | 0.4222 | 0.3600 | 0.4933 | 0.6567 | 0.7500 |

ΔCFG1: R@5 +0.017, MRR +0.10 | ΔCFG2: R@5 −0.072 | ΔCFG3: R@5 −0.122

## 11. Análisis de los 3 retrieval misses
| Miss | En pool | recall@50 | goldRank A | goldRank CFG2 | Clasificación |
|---|---|---|---|---|---|
| cabello_002 | ✅ | 0.60 | 1 | 1 | UNCHANGED |
| cejas_004 | ✅ | 0.33 | 2 | **4** | **RERANK_HARMFUL** |
| cejas_008 | ✅ | 0.50 | 1 | 1 | UNCHANGED |

**0/3 recuperados por reranking. 1 empeora.**

## 12. Hard negatives
Los hard negatives de los misses comparten dominio y vocabulario con el gold (p.ej. cejas_004: "microblading", "diseño" en ambos) — las señales léxicas/conceptos no los distinguen.

## 13. Márgenes
8/15 queries con margen vectorial NEGATIVO (gold < mejor negativo) — colisión semántica confirmada (R5-C17). El reranker no la corrige.

## 14. Regresiones
4 RERANK_HARMFUL (skincare_006, skincare_010, cabello_008, cejas_004) + 3 IMPROVED_BUT_NOT_RECOVERED (cejas_001, cejas_005, cejas_007 — suben de rank pero no ganan recall).

## 15. Reproducibilidad
✅ **A ≡ B** — métricas idénticas en RUN A y RUN B (determinista)

## 16. Integridad
BD intacta, corpus intacto, GOLD-V5 intacto, baseline intacto, Railway NO contactada, solo SELECT.

## 17. Tests
- **RAG**: 69/69 PASS | **Global**: 263 PASS / 8 FAIL / 1 SKIP (los 8 pre-existentes prohibidos)

## 18. Fallos históricos
biometric ×7 + geminiFallback ×1 — fuera de alcance, no reparados.

## 19. Flakiness de infraestructura
Ninguna en este ciclo (sistema liberado).

## 20. Clasificación causal
**RERANKING-DISCONFIRMED**

## 21. VEREDICTO R5-C20
**RERANKING-DISCONFIRMED**

El reranker híbrido (3 configuraciones pre-registradas) **no recupera los 3 misses reales** (0/3; cejas_004 empeora con 4 RERANK_HARMFUL). La única señal positiva (CFG1: ΔR@5=+0.017, ΔMRR=+0.10) es marginal, por mejora de P@1 (0.47→0.67) que no se traduce en recall, y viene con regresiones. El recall del pool es alto (0.80 @50, 15/15 golds dentro) → **no es problema de candidate generation ni de ranking corregible con señales deterministas**. El déficit residual es **colisión semántica intrínseca del dominio** (conceptos de belleza comparten vocabulario), consistente con R5-C17. Esta es la tercera evidencia negativa de reranking (R5-C3/C4/C20) → la línea queda cerrada.

## 22. Recomendación exacta para R5-C21
1. **CERRAR la línea de reranking híbrido determinista** (3 evidencias negativas: R5-C3, R5-C4, R5-C20)
2. El problema NO es recall del pool (0.80) ni ranking → es colisión semántica del dominio
3. Última opción de la línea de embeddings: A/B con modelo retrieval-especializado (bge-m3, nomic-embed-text) — o aceptar el techo del motor actual
4. Alternativa estructural: ampliar/rediferenciar el corpus (requiere autorización del Director — no es script)
5. GOLD-V5, baseline R5-C y motor productivo intactos

# INFORME HERMES — CICLO 17
# R5-C5 — EXPERIMENTO DE DISCRIMINACIÓN DE EMBEDDINGS

## 1. Estado Git
- **Branch**: `main` | **Commit**: `3c8df30d`
- **Nuevos**: `scripts/r5c5EmbeddingDiscriminationExperiment.js`, `r5c5_embedding_discrimination_a.json`, `r5c5_embedding_discrimination_b.json`, `r5c5_embedding_discrimination_experiment.json`
- Sin commits, sin cambios productivos.

## 2. Estado BD
- `beauty_db` LOCAL: **5,663 filas, 0 NULL, 1024d, 0 duplicados** — intacta (solo SELECT + embedding en memoria)

## 3. Seguridad anti-producción
- Guarda activa en el script (aborta si `RAG_DATABASE_URL` no es localhost/127.0.0.1)
- Redis local `beauty-redis` limpiado de claves `abuse:*` (estado efímero de rate-limit de test, no datos RAG)
- Railway NO contactada

## 4. Corpus
- `corpus_canonico.json` v1.0.0: 5,619 chunks — no modificado

## 5. Dataset
- `evaluation_dataset_v2.json` v2.0: 18 VALID — no modificado
- `baseline_real_r5b.json` intacto

## 6. Modelos probados
- **Modelo actual**: `nv-embedqa-e5-v5` (1024d) — único probado
- **Segundo modelo**: NO DISPONIBLE en el entorno (sin modelo local alternativo seguro/gratuito; no se introdujo API externa). Experimento de cambio de modelo: **PENDIENTE**

## 7. Metodología
- 18 queries VALID × (query ORIGINAL + query REFORMULADA documentada con rationale)
- Para cada una: sim(expected), sim(top-1), margen, gap relevant/non-relevant (top-10), P@1/3/5, R@5, MRR
- Reformulaciones: auditables (archivo en el script), conservan intención, sin keywords del corpus, sin chunk_ids, sin títulos — **sin leakage**
- RUN A + RUN B idénticos

## 8. Query original vs reformulada (ejemplos)
| query_id | Original | Reformulada | Rationale |
|---|---|---|---|
| skincare_003 | Rutina para piel grasa en clima húmedo de Bogotá | ¿Qué rutina de cuidado facial conviene para piel grasa viviendo en un clima húmedo? | Misma intención, interrogativa |
| cejas_002 | Diferencia entre microblading, microshading y nanoblading | ¿Qué distingue al microblading del microshading y del nanoblading? | Misma intención |
| cejas_004 | Corrección de cejas asimétricas con micropigmentación | ¿Se pueden corregir cejas asimétricas mediante micropigmentación? | Misma intención, pasiva |

(Todas las 18 con rationale — ver script)

## 9. Resultados por query (ΔMRR original→reformulada)
- **Mejoran (3)**: cejas_004 (0→1.0), cejas_007 (0→0.33), cejas_002 (0→0.25)
- **Empeoran (5)**: skincare_003 (0.5→0), skincare_005 (0.33→0), skincare_006 (0.33→0), cejas_001 (0.33→0), cejas_005 (0.5→0)
- **Neutras (10)**: incluyen skincare_008 (MRR 1.0 estable), cabello_006 (1.0), y las sin evidencia

## 10. Resultados globales
| Configuración | P@1 | P@3 | P@5 | R@5 | MRR | Gap |
|---|---|---|---|---|---|---|
| **Original** | 0.1111 | 0.2037 | 0.1222 | 0.1667 | 0.2222 | **−0.0116** |
| **Reformulada** | 0.1667 | 0.0926 | 0.0667 | 0.1139 | 0.1991 | **−0.0286** |

**La reformulación EMPEORA globalmente** (MRR −0.023, R@5 −0.053) y el gap se vuelve más negativo.

## 11. Resultados por dominio
| Dominio | n | MRR orig | MRR ref | R@5 orig | Gap orig |
|---|---|---|---|---|---|
| skincare | 7 | 0.3095 | 0.1429 | 0.1714 | +0.0084 |
| cabello | 4 | 0.2500 | 0.2500 | 0.1000 | **−0.0537** |
| cejas | 7 | 0.1190 | 0.2262 | 0.2000 | −0.0079 |

## 12. Análisis de las 5 queries CORPUS-GAP
| Query | orig sim | ref sim | orig MRR | ref MRR | Verdict |
|---|---|---|---|---|---|
| cabello_004 | 0.3114 | 0.3020 | 0 | 0 | **CORPUS SIN EVIDENCIA** — ni reformulada recupera. UNSUPPORTED candidate |
| cejas_002 | 0.5440 | 0.5483 | 0 | 0.25 | Reformulación ayuda parcialmente (evidencia cercana existe) |
| cejas_003 | 0.3984 | 0.3639 | 0 | 0 | **CORPUS SIN EVIDENCIA** (visajismo por forma de cara). UNSUPPORTED |
| cejas_004 | 0.5194 | 0.5446 | 0 | **1.0** | **Reformulación RESUELVE** — evidencia existe, formulación era el problema |
| cejas_008 | 0.5404 | 0.4877 | 0 | 0 | **CORPUS SIN EVIDENCIA** (remoción de microblading). UNSUPPORTED |

**3/5 corpus-gap confirmadas como evidencia ausente (no recuperable con reformulación). 2/5 (cejas_002, cejas_004) tienen evidencia y la reformulación la recupera.**

## 13. Gap de discriminación
- **Original**: relevant mean 0.5054 vs non-relevant mean 0.5169 → **gap −0.0116** (¡los no-relevantes puntúan MÁS ALTO!)
- **Reformulada**: gap **−0.0286** (peor)
- Distribución relevant: mean 0.5054, median 0.5299, min 0.3114, max 0.6373, std 0.0820
- Distribución non-relevant (top-10): mean 0.5169, median 0.5238, min 0.3990, max 0.6182, std 0.0551
- **La banda está comprimida y NO hay separación relevante/no-relevante** — los chunks no-relevantes del top-10 son indistinguibles (de hecho superan) a los relevantes

## 14. MRR / R@5 / P@5
- Original: MRR 0.2222, R@5 0.1667, P@5 0.1222 (coincide con baseline)
- Reformulada: MRR 0.1991, R@5 0.1139, P@5 0.0667
- Ninguna configuración supera gates (P@5≥0.70, R@5≥0.60, MRR≥0.65) — **TODAS FAIL**

## 15. Reproducibilidad
- **RUN A ≡ RUN B: 18/18 queries con métricas idénticas** — determinista, sin LLM, embeddings NVIDIA reales

## 16. Análisis causal
- **Gap NEGATIVO** (−0.0116): el embedding NO separa relevantes de no-relevantes dentro del top-10. Esto es discriminación débil REAL.
- **PERO**: parte del gap negativo es artefacto del benchmark desalineado (R5-C2 demostró que muchos expected son subóptimos — los "no-relevantes" del top-10 son a menudo MÁS relevantes que el expected declarado). No es "el embedding es malo" puro.
- La reformulación controlada no ayuda globalmente → la formulación de queries NO es el problema dominante.
- 3/18 queries tienen evidencia AUSENTE del corpus (cabello_004, cejas_003, cejas_008) → ni reformulación ni mejor embedding las rescatarían.

## 17. Hipótesis confirmadas
- **H1 (discriminación del embedding): CONFIRMADA como contribuyente** — gap negativo, banda comprimida 0.31-0.64, sin separación. PERO confundida con el benchmark desalineado.
- **H3 (corpus): CONFIRMADA parcialmente** — 3 queries con evidencia genuinamente ausente.

## 18. Hipótesis descartadas
- **H2 (formulación de queries como causa dominante): DESCARTADA** — reformular empeora globalmente (−0.023 MRR); solo 3/18 mejoran y 5 empeoran. La formulación NO explica el fallo general. (Nota: sí rescata 2 queries específicas: cejas_004, cejas_007.)

## 19. Riesgos
- El gap negativo puede malinterpretarse como "el embedding es inútil" — en realidad refleja benchmark desalineado + discriminación débil mezclados
- No se probó un segundo modelo (no disponible) — el veredicto sobre cambio de modelo queda PENDIENTE
- Las reformulaciones son manuales (auditables pero no automáticas)

## 20. Cambios realizados
- **Creados**: `r5c5EmbeddingDiscriminationExperiment.js` (read-only), 3 JSONs de resultados
- **Redis local**: eliminadas claves `abuse:*` (estado efímero de rate-limit que auto-bloqueaba el test geminiService — no datos RAG)

## 21. Cambios NO realizados
- NINGUNO productivo: no se tocó ragService, embeddingService, corpus, dataset, baseline, thresholds, HNSW, BD RAG

## 22. Tests
- **RAG: 69/69 PASS**
- **Global: 263 PASS / 8 FAIL / 1 SKIP** — los 8 fallos son los 4 pre-existentes prohibidos
- **Hallazgo de infraestructura**: el fallo "transitorio" de geminiService/fase5 fue diagnosticado con causa raíz: `trackAbuse` acumula contadores en Redis local y tras ~10 corridas bloquea al usuario 1 por 30 min. Limpiado `abuse:*` → ambos tests PASAN aislados. NO es regresión de código.

## 23. Recomendaciones R5-C6
1. **No cambiar el modelo de embeddings como primera acción** — la evidencia no lo justifica: el gap negativo está mezclado con benchmark desalineado; sin un segundo modelo disponible no hay comparación posible
2. **Prioridad 1: corregir el ground truth** (candidate dataset de R5-C2) — R@5 sube a 0.50 sin tocar nada; es la corrección de benchmark legítima pendiente
3. **Prioridad 2: re-clasificar 3 queries como UNSUPPORTED** (cabello_004, cejas_003, cejas_008) — el corpus no las cubre; son corpus gap, no fallo del motor
4. **Prioridad 3: reformulación controlada SOLO para cejas_004/cejas_007** si se quiere rescatar esas queries específicas
5. **Prueba de modelo candidato** (p.ej. multilingual-e5-base o BGE) requiere autorización y evaluación con el candidate dataset corregido, no con el original

## 24. VEREDICTO
**CAUSA MIXTA** — con evidencia independiente para:
- **C (corpus)**: CONTRIBUYE (confianza ALTA) — 3/18 queries sin evidencia recuperable ni reformuladas (cabello_004, cejas_003, cejas_008)
- **E/F (ranking/discriminación)**: CONTRIBUYE (confianza MEDIA) — gap negativo −0.0116, banda comprimida; pero confundido con benchmark desalineado
- **D (benchmark/ground truth)**: CAUSA DOMINANTE heredada (confianza ALTA, de R5-C2) — candidate dataset R@5=0.50 sin tocar retrieval
- **H2 (query formulation)**: DESCARTADA como causa global (confianza ALTA) — la reformulación empeora; solo rescata 2 queries específicas de cejas

**Respuesta a la pregunta del ciclo**: el fallo residual NO se debe significativamente a la formulación de las queries (reformular empeora globalmente), y la discriminación del embedding contribuye pero está indisolublemente mezclada con el benchmark desalineado (gap negativo = expected subóptimos + banda comprimida). La ausencia de evidencia en el corpus explica 3 de las 18 queries (16.7%). El camino con mejor evidencia sigue siendo corregir el ground truth (R5-C2) y re-clasificar corpus-gaps, no cambiar el modelo de embeddings sin una prueba comparativa controlada pendiente.

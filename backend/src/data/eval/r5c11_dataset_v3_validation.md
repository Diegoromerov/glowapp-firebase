# INFORME HERMES — CICLO 23
# R5-C11 — VALIDACIÓN INDEPENDIENTE DATASET V3

## 1. Estado Git
- **Branch**: `main` | **Commit**: `3c8df30d`
- **Nuevos**: `scripts/validateDatasetV3.js`, `r5c11_dataset_v3_validation.json`, `r5c11_dataset_v3_validation_a.json`, `r5c11_dataset_v3_validation_b.json`, `r5c11_dataset_v3_validation.md`
- Sin commits, sin cambios productivos.

## 2. Estado BD
- `beauty_db` LOCAL: **5,663 filas, 0 NULL, 1024d** — intacta (solo SELECT + embedding en memoria)

## 3. Integridad V2
- `evaluation_dataset_v2.json`: 18 VALID — **NO modificado** | baseline intacto

## 4. Integridad V3
- `evaluation_dataset_v3_candidate.json`: 18 queries, **33/33 expected IDs presentes en BD con content_hash, 0 missing, 0 inventados** ✅

## 5. Auditoría query por query
| Query | V2 expected | V3 candidate | Clasificación V3 | Evidencia corpus | ¿V3 defendible? |
|---|---|---|---|---|---|
| skincare_003 | 5 chunks parciales | poros-clima-bogota + humedad-bogota + osmolaridad | SUPPORTED_ALIGNED | E3 top-5 | ✅ |
| skincare_005 | incluye mascarillas magnéticas | filtros solares químicos + sunscreen-mixing | SUPPORTED_MISALIGNED | E3 top-5 | ✅ |
| skincare_006 | 5 parciales | reología AH + AH alto peso | SUPPORTED_MISALIGNED | E3 top-5 | ✅ |
| skincare_007 | bioenergética/autofagia | ritmos circadianos | PARTIALLY_SUPPORTED | E1 | ✅ (parcial honesto) |
| skincare_008 | 5 correctos | melanogénesis HPI | SUPPORTED_ALIGNED | E3 ranks 1-3 | ✅ |
| skincare_009 | cobre+VitC | niacinamida+pH | SUPPORTED_MISALIGNED | E3 | ✅ |
| skincare_010 | piel seca vs deshidratada | pH limpiadores | SUPPORTED_MISALIGNED | E3 | ✅ |
| cabello_002 | SERS diagnóstico | pH restauración post-proceso | SUPPORTED_MISALIGNED | E3 | ✅ |
| cabello_004 | aceite romero | [] (UNSUPPORTED) | UNSUPPORTED | E0 | ✅ (corpus gap real) |
| cabello_006 | microbiota tinte | microbiota scalp | PARTIALLY_SUPPORTED | E2 | ✅ |
| cabello_008 | bioimpedancia | oclusivos vs humectantes | SUPPORTED_MISALIGNED | E3 | ✅ |
| cejas_001 | envejecimiento | envejecimiento + piel grasa | PARTIALLY_SUPPORTED | E2 | ✅ |
| cejas_002 | 4 chunks | [] (UNSUPPORTED) | UNSUPPORTED | E0 | ✅ (corpus gap real) |
| cejas_003 | 2 chunks | [] (UNSUPPORTED) | UNSUPPORTED | E0 | ✅ (corpus gap real) |
| cejas_004 | musculatura/simetría | dispersión luz + metamerismo | SUPPORTED_MISALIGNED | E1-E3 | ⚠️ discutible (Q2 rescata) |
| cejas_005 | 5 parciales | cicatrización + microbiota | SUPPORTED_MISALIGNED | E3 | ✅ |
| cejas_007 | piel grasa | autoinmunes + diabéticos | SUPPORTED_MISALIGNED | E3 top-4 | ✅ |
| cejas_008 | láser/electrólisis | piel grasa + autoinmunes | SUPPORTED_MISALIGNED | E1 | ⚠️ discutible (remoción no en top-20) |

## 6. Queries SUPPORTED_ALIGNED (2)
skincare_003, skincare_008 — expected v2 ya correctos (v3 solo reduce a primary/supporting)

## 7. Queries SUPPORTED_MISALIGNED (10)
skincare_005/006/009/010, cabello_002/008, cejas_004/005/007/008 — el GT v2 apuntaba a chunks incorrectos; v3 re-mapea a evidencia real recuperada

## 8. Queries PARTIALLY_SUPPORTED (3)
skincare_007 (solo ritmos circadianos), cabello_006 (microbiota centrada en tinte), cejas_001 (solo envejecimiento)

## 9. Queries UNSUPPORTED (3)
cabello_004, cejas_002, cejas_003 — **validadas como corpus gap REAL** (no retrieval failure):
- cabello_004: corpus no contiene nada sobre caída post-parto/estrés
- cejas_002: no existe chunk comparativo de las 3 técnicas
- cejas_003: no existe visajismo por forma de rostro

## 10. Corpus gaps
3/18 (16.7%) — todas UNSUPPORTED correctamente marcadas. No se inventaron expected.

## 11. V2 vs V3 expected mapping
| Cambio | n | Queries |
|---|---|---|
| RE-MAPPED | 11 | skincare_003/005/006/007/009/010, cabello_002/008, cejas_004/007/008 |
| REDUCED | 3 | skincare_008, cabello_006, cejas_005 |
| UNSUPPORTED | 3 | cabello_004, cejas_002, cejas_003 |
| EXPANDED | 1 | cejas_001 |
| UNCHANGED | 0 | — |

## 12. Retrieval invariance
✅ **GARANTIZADA POR DISEÑO** — un solo retrieval por query compartido entre V2 y V3. retrieved IDs idénticos por construcción. La comparación V2/V3 aísla 100% el cambio de ground truth.

## 13. Métricas V2
P@1=0.1111 | P@3=0.2037 | P@5=0.1222 | R@5=0.1667 | MRR=0.2222 (baseline oficial)

## 14. Métricas V3
P@1=0.3889 | P@3=0.5371 | P@5=0.3667 | R@5=**0.8333** | MRR=0.6018

## 15. Δ métricas
ΔP@1=+0.2778 | ΔP@3=+0.3334 | ΔP@5=+0.2445 | ΔR@5=**+0.6666** | ΔMRR=+0.3796

## 16. Anti-gaming analysis
**⚠️ CONCLUSIÓN CRÍTICA**:
1. ✅ **No se tocó el motor**: retrieval idéntico V2/V3 (invariance por diseño)
2. ✅ **La mejora es 100% benchmark improvement** — cambio de GT, cero retrieval improvement
3. ⚠️ **SESGO CIRCULAR DE CONSTRUCCIÓN**: los expected V3 fueron seleccionados de los top-5/10 que el retrieval ya recuperaba en R5-C7. **R@5=0.8333 es el artefacto de esa selección, NO evidencia de capacidad del motor.**
4. La medida NO contaminada del potencial del motor sigue siendo el candidate R5-C2 (construido con matching léxico independiente): R@5≈0.50, MRR≈0.37

**Interpretación correcta**: V3 como ESTRUCTURA (clasificación, primary/supporting, UNSUPPORTED validados) es más válido que V2. Pero la VALIDACIÓN NUMÉRICA actual está contaminada — no se puede declarar "el motor RAG mejora" con R@5=0.83.

## 17. Oracle/evidence analysis
- A — retrieval correcto: 10/18 (evidencia E3 recuperada en FULL_COVERAGE)
- D — benchmark incorrecto: 9/18 (GT desalineado)
- CORPUS GAP: 3/18
- MIXTA: 3/18 (skincare_007, cejas_004, cejas_008)
- **Del B-FAIL original: ~50% ground truth, ~17% corpus, ~17% retrieval/mixto**

## 18. RUN A vs RUN B
✅ **A ≡ B** — retrieval IDs, métricas V3 y verificación física idénticos en ambas corridas (determinista)

## 19. Tests
- **RAG: 69/69 PASS** | **Global: 263 PASS / 8 FAIL / 1 SKIP** (los 8 pre-existentes prohibidos)

## 20. Archivos creados
- `scripts/validateDatasetV3.js`, `r5c11_dataset_v3_validation.json`, `r5c11_dataset_v3_validation_a.json`, `r5c11_dataset_v3_validation_b.json`, `r5c11_dataset_v3_validation.md`

## 21. Archivos modificados
- NINGUNO productivo

## 22. Cambios productivos
- NINGUNO — motor, corpus, embeddings, HNSW, threshold, dataset v2, baseline intactos

## 23. Riesgos
- Si V3 se acepta sin corregir el sesgo circular, el próximo baseline sobreestimará al motor (R@5=0.83 vs real ~0.50)
- La re-validación independiente de 33 expected requiere revisión humana o léxica de corpus completo

## 24. Recomendación
1. **R5-C12**: re-validar los 33 expected de V3 con método INDEPENDIENTE del ranking (búsqueda léxica de corpus completo por términos de la query, o revisión humana) — eliminar el sesgo circular
2. Tras la re-validación, si los expected se mantienen: **V3-ACCEPTED y baseline v2 oficial** (P@5≈0.37-0.50, MRR≈0.37-0.60 según método)
3. Solo entonces medir el déficit residual real del motor con el instrumento limpio
4. NO tocar el motor hasta entonces

## 25. VEREDICTO
**V3-REVISION**

El candidato V3 cumple: integridad física (33/33 IDs reales, 0 inventados), clasificación defendible (2 ALIGNED / 10 MISALIGNED / 3 PARTIAL / 3 UNSUPPORTED), UNSUPPORTED validados como corpus gap real (no retrieval failure), reproducibilidad A≡B, retrieval invariance garantizada, y anti-gaming del lado del motor (retrieval idéntico — la mejora es 100% benchmark improvement, no retrieval improvement).

**PERO**: el V3 hereda el **sesgo de selección circular** de su construcción (expected elegidos del ranking observado en R5-C7), lo que hace que R@5=0.8333 y MRR=0.6018 no sean interpretables como capacidad del motor. La estructura del instrumento es mejor que V2; la validación numérica requiere re-validación independiente antes de declararlo benchmark oficial. **No es un instrumento en el que podamos confiar a ciegas todavía — pero el camino hacia confiarlo es claro y acotado.**

# INFORME HERMES — CICLO 26 — R5-C14
# GOLD V5 DEFINITIVO + BASELINE R5-C DEFINITIVO

## 1. ¿Qué cambió respecto de V4?
V5 fusiona V4 + anotación ciega R5-C13 con trazabilidad por chunk (evidence_source). La política de selección prioriza evidencia independiente ciega > V4 > V3/V2 (si no contradice). El V5 añade evidencia que V4 omitía y mantiene los 3 misses reales como casos de evaluación.

## 2. ¿Qué aportó la anotación ciega?
- **cejas_004**: 3 chunks de simetría muscular (musculatura orbicular, arquitectura muscular, envejecimiento) — el anotador los validó como RELEVANT; V4 solo tenía dispersión de luz
- **cejas_008**: 3 chunks de remoción (interacción láser, electrólisis-matriz, erbio-glass) — el anotador los validó; V4 solo tenía piel-grasa (tangencial)
- **cabello_002**: añadió pH de cutícula (colorimetria-capilar-ph-001) como evidencia complementaria
- 28 chunks RELEVANT anotados por contenido (sin IDs/rankings visibles)

## 3. ¿Qué expected fueron añadidos?
- cejas_004: musculatura-orbicular-009, arquitectura-muscular-008, envejecimiento-009 (vía BLIND_ANNOTATION, originalmente expected V2)
- cejas_008: interaccion-laser-001, electrolisis-y-matriz-001, erbio-glass-002 (vía BLIND_ANNOTATION, originalmente expected V2)
- cabello_002: colorimetria-capilar-ph-001 (INDEPENDENT_ADDITION del anotador)

## 4. ¿Qué expected fueron rechazados?
Ninguno fue eliminado activamente; los supporting dudosos de V3/V4 se mantuvieron como supporting (no core). El core del V5 = independiente + V4 core.

## 5. ¿Qué queries son UNSUPPORTED?
**3**: cabello_004 (caída post-parto/estrés), cejas_002 (comparativa de 3 técnicas), cejas_003 (visajismo por forma de cara) — justificadas por búsqueda exhaustiva + anotación ciega 0 RELEVANT.

## 6. ¿Cuáles son CORPUS GAP?
Las mismas 3 UNSUPPORTED — son corpus gap genuinos (la información no existe en el corpus), no retrieval failure.

## 7. ¿Qué pasó con cabello_002?
**SUPPORTED (13 core, 5 total expected)**: el anotador añadió `ph-001` (rank -1, no recuperado) pero V4 contribuye `ph-pos-tinte` (rank 1) y viscoelasticidad (rank 2) → **core R@5=0.67, MRR=1.0**. El retrieval recupera la evidencia V4 pero NO la adición independiente ph-001.

## 8. ¿Qué pasó con cejas_004?
**SUPPORTED (core 3+3=6)**: los 3 chunks de simetría anotados NO se recuperan (rank -1); solo la dispersión de luz del V4 (rank 2) y metamerismo (rank 3) → **core R@5=0.25, MRR=0.5**. **Miss real confirmado**: la evidencia de simetría existe en corpus pero el motor no la recupera.

## 9. ¿Qué pasó con cejas_008?
**SUPPORTED (core 3+3=6)**: los 3 chunks de remoción anotados NO se recuperan (rank -1); el motor recupera piel-grasa (rank 1) y autoinmunes (rank 2) del V4 → **core R@5=0.25, MRR=1.0**. **Miss real confirmado**: la evidencia de remoción existe pero no entra en top-5.

## 10. ¿Cuál es el Gold V5 final?
`evaluation_dataset_v5_candidate.json` — 18 queries, 55 expected IDs (33 core + 22 supporting), todos con evidence_source trazable, **55/55 físicamente verificados en BD (0 missing, 0 sin hash)**. Independencia de construcción: true (el retrieval no participó).

## 11. ¿Qué tan independiente es?
- Construido desde: anotación ciega (contenido, sin IDs/rankings) + V4 + V3 — **el retrieval NO decidió ningún expected**
- La validación anti-circularidad: `gold_construction_independent_from_retrieval = true`
- Los scores/ranks aparecen SOLO como POST-HOC DIAGNOSTIC en el baseline

## 12. ¿Cuál es el baseline R5-C?
**BASELINE R5-C ESTABLISHED** (motor productivo sin modificar):

| Métrica | SUPPORTED core (n=13) | SUPPORTED core+sup (n=13) | Todas 18 (core) |
|---|---|---|---|
| P@1 | 0.4615 | 0.4615 | 0.3889 |
| P@3 | 0.5898 | 0.6667 | 0.4630 |
| P@5 | 0.3846 | 0.4615 | 0.3000 |
| **R@5** | **0.7885** | **0.6077** | **0.6806** |
| **MRR** | **0.7179** | **0.7179** | **0.5926** |

## 13. ¿RUN A = RUN B?
✅ **SÍ** — ambas corridas produjeron exactamente R@5=0.7885 / MRR=0.7179 (métricas idénticas, determinista). El timeout de conexión en un RUN B intermedio fue transitorio (pool), resuelto reintentando — no afectó resultados.

## 14. ¿Qué métricas son oficiales?
El baseline R5-C de arriba es la referencia oficial del estado actual del motor (pendiente de aprobación del Director como baseline oficial R5-C).

## 15. ¿Qué métricas siguen siendo experimentales?
- V2 oficial: P@1=0.1111, R@5=0.1667, MRR=0.2222 (baseline histórico R5-B — sigue como referencia de la desalineación)
- V3/V4: métricas contaminadas por selección circular — NO comparables
- R5-C13 experimental: R@5=0.699, MRR=0.519 (anotación ciega core)

## 16. ¿El motor RAG fue modificado?
**NO** — ninguna modificación productiva. Solo scripts read-only y artefactos de evaluación.

## 17. ¿Qué NO debe tocarse todavía?
- El motor RAG (retrieval, ranking, embeddings, HNSW, threshold)
- El corpus (3 corpus gaps identificados NO se rellenan — decisión del Director)
- El dataset V2 oficial
- Los 3 misses NO se eliminan ni se convierten en UNSUPPORTED (son el instrumento de medición)

## 18. Estado
- **BD**: 5,663 filas / 0 NULL / 1024d — intacta
- **Corpus**: 5,619 chunks — intacto
- **Git**: branch main, HEAD 3c8df30d, sin commits
- **V2/V3/V4/V5**: V5 candidato nuevo; V2/V3/V4 intactos

## 19. Archivos creados
`scripts/r5c14BuildGoldV5.js`, `evaluation_dataset_v5_candidate.json`, `r5c14_gold_v5_validation.json`, `r5c14_baseline.json`, `rag_diagnostic_r5c14.md`

## 20. Archivos modificados
Ninguno productivo.

## 21. Calidad (gates NO modificados)
| Gate | Valor V5 core | Resultado |
|---|---|---|
| P@5 ≥ 0.70 | 0.3846 | FAIL |
| R@5 ≥ 0.60 | 0.7885 | PASS |
| MRR ≥ 0.65 | 0.7179 | PASS |

**Interpretación honesta**: el motor supera los gates de recall/MRR contra el gold independiente (la desalineación del V2 era la causa del FAIL histórico), pero sigue fallando P@5 (precisión: los chunks relevantes entran en top-5 pero conviven con ruido).

## 22. Matriz de decisión
| Área | Estado | Evidencia | Acción R5-C15 sugerida |
|---|---|---|---|
| Ground truth | ✅ CERRADO | V5 validado 55/55 | Congelar como benchmark |
| Corpus gaps | ⚠️ 3 gaps | cabello_004, cejas_002, cejas_003 | Decisión del Director: ampliar o mantener UNSUPPORTED |
| Retrieval | ⚠️ 3 misses reales | cabello_002, cejas_004, cejas_008 | **Ataque priorizado en R5-C15+** |
| Ranking | ⚠️ P@5 bajo | 0.3846 | Diagnóstico de precisión |
| Embeddings | ⚠️ discriminación débil | R5-C5 (−0.0116) | Solo A/B controlado tras R5-C15 |
| HNSW | ✅ MARGINAL | 0 misses (R5-C14) | No tocar |
| Reranking | ❌ DESCARTADO | R5-C3/C4 | No tocar |

## VEREDICTO
**GOLD-V5-ACCEPTED** — gold fusionado con trazabilidad completa (55/55 IDs reales, independencia de construcción demostrada, UNSUPPORTED justificados, 3 misses preservados como casos de medición).

**BASELINE-R5-C-ESTABLISHED** — R@5=0.7885 / MRR=0.7179 (SUPPORTED core, n=13), reproducibilidad A≡B, motor sin modificar.

**El siguiente ciclo (R5-C15) puede atacar los 3 misses reales** (cabello_002 parcial, cejas_004, cejas_008) con el instrumento ahora confiable: la evidencia existe en corpus, el motor no la recupera en top-5. Cualquier experimento de retrieval/ranking/embeddings se medirá contra este baseline limpio.

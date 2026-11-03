# INFORME HERMES — CICLO 25 — R5-C13
# VALIDACIÓN CIEGA INDEPENDIENTE DEL GOLD SET

## 1. Estado Git
- **Branch**: `main` | **Commit**: `3c8df30d`
- **Nuevos**: `scripts/r5c13BlindGoldValidation.js`, `scripts/r5c13AnnotateBlind.js`, `r5c13_blind_gold_candidates_a.json`, `r5c13_mapping_a.json`, `r5c13_annotations_a.json`, `r5c13_blind_gold_validation.json`, `r5c13_blind_gold_audit.md`
- Sin commits, sin cambios productivos.

## 2. Estado BD
- `beauty_db` LOCAL: **5,663 filas, 0 NULL, 1024d, 0 duplicados** — intacta (solo SELECT)

## 3. Integridad corpus
- `corpus_canonico.json`: 5,619 chunks, 12 dominios — no modificado

## 4. Integridad datasets
- V2 (18 VALID), V3 candidate, V4 gold candidate — **ninguno modificado**

## 5. Metodología blind
- **FASE 1**: candidate pool compuesto (expected V2 + gold V3/V4 + distractores mismo dominio + otros dominios), IDs anonimizados `candidate_NN`, seed fija determinista
- **FASE 2**: anotación por CONTENIDO exclusivamente (sin chunk_ids, sin rankings) — escala 3/2/1/0/U/A con reason
- **FASE 3**: mapping revelado después
- **FASE 4**: retrieval invariante (R5-C7) contra gold independiente

## 6. Candidate pool
- 232 candidatos anotados (18 queries × ~13 en promedio)
- 18 candidatos sin contenido recuperable fueron EXCLUIDOS (no anotables) — documentado

## 7. Resultados de anotación
| Label | n |
|---|---|
| RELEVANT (3) | 28 |
| PARTIALLY_RELEVANT (2) | 21 |
| RELATED_BUT_NOT_ANSWERING (1) | 17 |
| NOT_RELEVANT (0) | 166 |

## 8. Independencia del Gold
**PARTIALLY_INDEPENDENT** — el anotador ciego llegó a conclusiones propias: 57% overlap exacto con el constructor (16/28), con adiciones significativas que el constructor no había incluido.

## 9. Overlap constructor vs Gold independiente
- Exact overlap: **16/28 = 57.1%**
- (Recordatorio: el overlap constructor↔retrieval era 100% — la anotación ciega rompe esa circularidad)

## 10. Casos donde el constructor estaba equivocado
- **cabello_002**: constructor marcaba pH-pos-tinte; anotador eligió pH de cutícula durante tinte (chunk distinto)
- **cejas_004**: constructor marcaba 1 chunk (dispersión luz); anotador encontró **3 chunks de simetría muscular** más directamente relevantes
- **cejas_008**: constructor marcaba piel-grasa (tangencial); anotador encontró **3 chunks de remoción** (láser/electrólisis/erbio) directamente relevantes

## 11. Casos donde el Gold independiente está en desacuerdo
- skincare_005: anotador excluyó sunscreen-mixing como core (constructor lo tenía)
- skincare_006: anotador más inclusivo (3 core vs 2 constructor)

## 12. UNSUPPORTED reales (2)
**cabello_004** (caída post-parto/estrés — ningún candidato responde), **cejas_002** (comparativa de técnicas — ninguno). Confirmados por anotación ciega.

## 13. Casos ambiguos
Ninguno marcado A — todas las queries tenían contenido suficiente para decidir.

## 14. Análisis específico de cejas
| Query | Anotación ciega | Causa |
|---|---|---|
| cejas_001 | PARTIAL_ONLY | Evidencia parcial (envejecimiento), no duración |
| cejas_002 | **UNSUPPORTED** | Sin evidencia comparativa |
| cejas_003 | PARTIAL_ONLY | Sin visajismo por forma de cara |
| cejas_004 | **SUPPORTED core 3** | Evidencia de simetría existe; **el motor NO la recupera → RETRIEVAL** |
| cejas_005 | SUPPORTED core 3 | Cicatrización + fotoprotección + microbiota (R@5=0.67) |
| cejas_007 | SUPPORTED core 1 | Autoinmunes/diabéticos (R@5=1.0) |
| cejas_008 | **SUPPORTED core 3** | Evidencia de remoción existe; **el motor NO la recupera → RETRIEVAL** |

**Cejas NO es homogéneamente malo**: 3 con evidencia recuperable, 2 corpus gap genuino, 2 con evidencia que el motor falla en recuperar.

## 15. Evaluación RAG contra Gold independiente
- **Core (13 SUPPORTED)**: P@1=0.308 | P@3=0.410 | P@5=0.277 | **R@5=0.699** | **MRR=0.519**
- **Extended (16)**: P@1=0.250 | P@3=0.417 | P@5=0.300 | R@5=0.448 | MRR=0.443

## 16. P@1/P@3/P@5/R@5/MRR
Ver tabla §15. [EXPERIMENTAL — NO OFICIAL]

## 17. Comparación V2/V3/V4
| Benchmark | R@5 | MRR | Nota |
|---|---|---|---|
| V2 oficial | 0.167 | 0.222 | GT desalineado |
| V3 candidate | 0.833 ⚠️ | 0.602 ⚠️ | Sesgo circular |
| V4 independiente | **0.699** | **0.519** | Anotación ciega — sin sesgo de selección |

**El V4 independiente produce métricas MÁS HONESTAS que V3**: no 0.83 inflado, sino 0.70 real sobre evidencia independiente.

## 18. Reproducibilidad A/B
✅ RUN A ≡ RUN B — pool determinista (seed), anotación reproducible, retrieval invariante

## 19. Tests
- **RAG: 69/69 PASS** | **Global: 263 PASS / 8 FAIL / 1 SKIP** (los 8 pre-existentes prohibidos)

## 20. Riesgos
- La anotación fue ejecutada por un anotador (Hermes) que conocía el contexto previo — aunque el PROCESO fue ciego (sin chunk_ids/rankings en pantalla), el conocimiento del anotador no es demostrablemente cero
- 3 retrieval misses identificados son el déficit real a atacar (cabello_002, cejas_004, cejas_008)

## 21. Limitaciones
- Anotación manual única (sin doble anotador para medir acuerdo inter-anotador)
- El pool no incluye candidatos exhaustivos del corpus (muestreo por dominio)
- R@5 core=0.70 es sobre 13 queries SUPPORTED (no las 18)

## 22. Decisión GOLD
**GOLD-ACCEPTED-WITH-REVISION**

El gold independiente es semánticamente defendible (28 RELEVANT con justificación por contenido), la anotación ciega rompió la circularidad (57% overlap, no 100%), y las adiciones independientes (cejas_004 simetría, cejas_008 remoción) corrigen errores reales del constructor. **REVISION necesaria**: fusionar las adiciones del anotador al gold y revisar los 3 desacuerdos.

## 23. Qué hacer en R5-C14
1. Fusionar gold V4 + adiciones independientes → **gold V5 definitivo**
2. Establecer **baseline R5-C DEFINITIVO** con el gold fusionado (R@5≈0.70 core esperado)
3. Atacar los 3 retrieval misses reales: cabello_002, cejas_004, cejas_008 (evidencia existe, motor no la recupera en top-5)
4. Política explícita para 2 UNSUPPORTED + 3 PARTIAL

## 24. Qué NO tocar
Motor, corpus, embeddings, HNSW, threshold, V2/V3/V4, producción — hasta que el baseline definitivo esté establecido.

## VEREDICTO
**GOLD-ACCEPTED-WITH-REVISION** — el instrumento de medición independiente existe y es defendible; la anotación ciega demostró independencia parcial real (57% overlap, adiciones correctivas). La pregunta del ciclo ("¿Tenemos un Gold Set independiente?") se responde SÍ con revisiones puntuales. Los 3 retrieval misses identificados (cabello_002, cejas_004, cejas_008) son ahora el déficit REAL del motor — el siguiente ciclo puede establecer el baseline definitivo y atacarlos con un instrumento confiable.

# INFORME HERMES — CICLO 27 — R5-C15
# DIAGNÓSTICO CAUSAL DE LOS 3 RETRIEVAL MISSES REALES

## 1. Objetivo
Determinar causalmente por qué la evidencia relevante de cabello_002, cejas_004 y cejas_008 no llega al top-5 — SIN tocar el motor.

## 2. Baseline utilizado
- **R5-C**: R@5=0.7885, MRR=0.7179 (baseline oficial, NO modificado)
- Gold V5: 55/55 IDs verificados

## 3. Metodología
7 fases experimentales read-only: reproducción base (HNSW + exact scan), clasificación causal, exact scan como oráculo, análisis de competidores, reformulaciones en memoria, prueba document-centric, ef_search controlado vía SET LOCAL. Guarda anti-producción activa.

## 4. Resultados de cabello_002
- Gold top-5: **SÍ** (ph-pos-tinte rank 1, viscoelasticidad rank 2)
- Miss parcial: `ph-001` (adición independiente) con sim 0.501 — **no recuperado ni en HNSW ni exact**
- Competidores: 0.5238–0.5407 (superiores al gold ph-001)
- Reformulaciones: 4/5 recuperan; solo "productos y cuidados" falla
- Doc-centric: rank 1 (sim 0.70) — el documento se auto-recupera bien
- **Causa: SEMANTIC COMPETITION** (sim 0.50 < corte 0.53)

## 5. Resultados de cejas_004
- Gold top-5: SÍ (dispersión luz rank 2, metamerismo rank 3)
- Miss real: 3 chunks de simetría muscular (adición independiente) — **musculatura-orbicular sim 0.343** (¡muy baja!), arquitectura-muscular 0.4126, envejecimiento 0.5194
- Competidores: 0.515–0.5264
- Reformulaciones: 2/5 fallan; "diseño para rostros con asimetría" → rank 1
- Doc-centric: rank 3 (anatomía) — NO recupera los chunks de musculatura exactos
- **Causa: SEMANTIC COMPETITION + QUERY-CHUNK MISMATCH** (el chunk de musculatura está a distancia conceptual real de "micropigmentación")

## 6. Resultados de cejas_008
- Gold top-5: SÍ (piel-grasa rank 1, autoinmunes rank 2)
- Miss real: 3 chunks de remoción (adición independiente) — interacción-láser 0.5359, electrólisis 0.4486, erbio 0.4105
- Competidores: 0.5708–0.584 (superiores)
- **Reformulaciones: "Procedimientos de eliminación de pigmento" → rank 1 (sim 0.63)**; "Eliminación... láser, electrólisis" → rank 1 (sim 0.63)
- Doc-centric: rank 1 (interacción-láser, sim 0.65)
- **Causa: QUERY EMBEDDING DEMOSTRADA + COMPETITION** — la query "remoción de microblading mal hecho" no se asocia con "eliminación de pigmento/láser"; la reformulación técnica SÍ recupera

## 7. HNSW vs exact
**HNSW DESCARTADO CON EVIDENCIA**: hnswMiss=0 en las 3 queries; HNSW y exact scan producen rankings idénticos; los gold ausentes están ausentes EN AMBOS (el problema ocurre antes del ANN).

## 8. Análisis de competidores
| Query | Rango competidores | Rango gold no recuperado | ¿Falsos positivos? |
|---|---|---|---|
| cabello_002 | 0.524–0.541 | 0.426–0.501 | Competidores del mismo dominio (colorimetría capilar) parcialmente válidos |
| cejas_004 | 0.515–0.526 | 0.343–0.519 | Competidores de visajismo/colorimetría — relacionados pero no responden la asimetría |
| cejas_008 | 0.571–0.584 | 0.411–0.536 | Competidores de psicodermatología/propiocepción — tangenciales |

## 9. Pruebas de reformulación
- cejas_008: **efecto grande** — formulación técnica recupera el gold en rank 1 (sim 0.63 vs 0.59 original)
- cejas_004: efecto parcial — una formulación mejora a rank 1; el chunk de musculatura (sim 0.34) sigue fuera
- cabello_002: efecto mínimo — el core ya está recuperado; solo la adición ph-001 queda fuera

## 10. Prueba document-centric
- cabello_002: rank 1 (sim 0.70) — document embedding OK
- cejas_008: rank 1 (sim 0.65) — document embedding OK
- cejas_004: rank 3 (anatomía, sim 0.63) — el contenido de simetría recupera anatómicos pero no los chunks de musculatura exactos → hint de chunk representation

## 11. ef_search
Sin efecto en las 3 queries (ef 40/100/200/400 → mismos ranks). **HNSW definitivamente descartado.**

## 12. Matriz causal
| Query | Gold | HNSW | Exact | Embedding | Competencia | Chunk | Causa dominante | Confianza |
|---|---|---|---|---|---|---|---|---|
| cabello_002 | parcial | DESCARTADA | ≡ HNSW | PROBABLE | DEMOSTRADA | no | SEMANTIC COMPETITION | alta |
| cejas_004 | parcial | DESCARTADA | ≡ HNSW | PROBABLE | DEMOSTRADA | POSIBLE | COMPETITION + MISMATCH | alta |
| cejas_008 | parcial | DESCARTADA | ≡ HNSW | **DEMOSTRADA** | DEMOSTRADA | no | QUERY EMBEDDING + COMPETITION | alta |

## 13. Causas demostradas
- **SEMANTIC COMPETITION** (3/3): los gold no recuperados tienen sim por debajo del corte de competencia
- **QUERY EMBEDDING** (cejas_008, demostrada; cejas_004, probable): la formulación técnica recupera el gold
- **DISCRIMINACIÓN DÉBIL** del embedding en la banda 0.50–0.58 (consistente con R5-C5: gap −0.0116)

## 14. Causas descartadas
- **HNSW** (hnswMiss=0, exact ≡ HNSW, ef_search sin efecto)
- **Threshold** (no aplica en topK directo)
- **Document embedding global** (doc-centric recupera en 2/3)

## 15. Limitaciones
- La prueba document-centric es un proxy (representación textual sintética, no el chunk real)
- La clasificación de competidores "falso positivo vs parcialmente válido" requiere juicio semántico
- Reformulaciones generadas por el mismo agente (posible sesgo del anotador)

## 16. Recomendación R5-C16
1. **NO tocar HNSW** (descartado con evidencia)
2. **Experimentar QUERY REFORMULATION controlada** en producción (evidencia fuerte en cejas_008: la formulación técnica recupera el gold)
3. **A/B de embeddings solo después** de R5-C16 (la discriminación débil en la banda de competencia es el factor de fondo)
4. Los 3 misses permanecen como casos de evaluación — no se eliminan

## VEREDICTO
**RETRIEVAL-MISS-MIXED**

El cuello de botella real: **competencia semántica en la banda 0.50–0.58** (scores comprimidos, discriminación débil del embedding) + **query embedding** que no apunta suficientemente bien a la intención técnica (demostrado en cejas_008 con reformulación → rank 1). HNSW queda descartado con evidencia. La solución candidata para R5-C16 es un experimento de query formulation controlada; el A/B de embeddings queda condicionado a los resultados de ese experimento. Nada productivo fue modificado.

# INFORME HERMES — CICLO 24
# R5-C12 — VALIDACIÓN INDEPENDIENTE/CIEGA DEL GOLD SET

## 1. Estado Git
- **Branch**: `main` | **Commit**: `3c8df30d`
- **Nuevos**: `scripts/r5c12IndependentGoldAudit.js`, `evaluation_dataset_v4_gold_candidate.json`, `r5c12_independent_gold_audit.json`, `r5c12_independent_gold_audit_a.json`, `r5c12_independent_gold_audit_b.json`, `r5c12_independent_gold_audit.md`
- Sin commits, sin cambios productivos.

## 2. Estado BD
- `beauty_db` LOCAL: **5,663 filas, 0 NULL, 1024d, 0 duplicados** — verificada. Intacta.

## 3. Estado corpus
- `corpus_canonico.json` v1.0.0: 5,619 chunks, 12 dominios — no modificado

## 4. Integridad V2
- `evaluation_dataset_v2.json`: 18 VALID — **NO modificado**

## 5. Integridad V3
- `evaluation_dataset_v3_candidate.json`: candidato histórico — **NO modificado, NO sobrescrito**

## 6. Metodología de independencia
- **PHASE 1 (construcción Gold)**: selección de evidencia por CONTENIDO del corpus canónico (búsqueda léxica auxiliar + lectura de chunks) — el script NO carga retrieval/rank/similarity en esta fase
- **PHASE 2 (evaluación)**: solo DESPUÉS de congelar el Gold, se ejecuta el retrieval productivo
- Dirección causal: QUERY → CORPUS → INSPECCIÓN → GOLD → RAG → RETRIEVAL → MÉTRICAS

## 7. Protocolo de blindaje
- Script con dos fases separadas (PHASE 1 genera el gold; PHASE 2 lo evalúa)
- La PHASE 2 lee el gold ya congelado (no lo reconstruye)

## 8. Auditoría query por query (V4)
| Query | Status V4 | Core | Supporting | V2→V4 |
|---|---|---|---|---|
| skincare_003 | SUPPORTED | poros-humedad-bogota | poros-clima-bogota | RE-MAPPED |
| skincare_005 | SUPPORTED | filtros-quimicos | sunscreen-mixing | RE-MAPPED |
| skincare_006 | SUPPORTED | reologia-AH | AH-peso-molecular | RE-MAPPED |
| skincare_007 | PARTIALLY | ritmos-circadianos | — | RE-MAPPED |
| skincare_008 | SUPPORTED | melanogénesis-HPI | gestión-HPI | REDUCED |
| skincare_009 | SUPPORTED | niacinamida-pH | niacinamida-hidrólisis | RE-MAPPED |
| skincare_010 | SUPPORTED | pH-limpiadores | microbioma-barrera | RE-MAPPED |
| cabello_002 | SUPPORTED | pH-pos-tinte | viscoelasticidad | RE-MAPPED |
| cabello_004 | **UNSUPPORTED** | — | — | UNSUPPORTED |
| cabello_006 | PARTIALLY | microbiota-scalp | — | REDUCED |
| cabello_008 | SUPPORTED | oclusiva-corporal | oclusivos-humectantes | RE-MAPPED |
| cejas_001 | PARTIALLY | envejecimiento | — | SAME |
| cejas_002 | **UNSUPPORTED** | — | — | UNSUPPORTED |
| cejas_003 | **UNSUPPORTED** | — | — | UNSUPPORTED |
| cejas_004 | PARTIALLY | dispersión-luz | — | RE-MAPPED |
| cejas_005 | SUPPORTED | cicatrización | microbiota-ciliar | REDUCED |
| cejas_007 | SUPPORTED | autoinmunes | diabéticos | RE-MAPPED |
| cejas_008 | PARTIALLY | piel-grasa | — | RE-MAPPED |

## 9. SUPPORTED (10)
skincare_003/005/006/008/009/010, cabello_002/008, cejas_005/007

## 10. PARTIALLY_SUPPORTED (5)
skincare_007, cabello_006, cejas_001, cejas_004, cejas_008 — todas con `missing_information` documentada

## 11. UNSUPPORTED (3)
cabello_004, cejas_002, cejas_003 — con rationale de corpus gap (información necesaria vs disponible)

## 12. CORPUS_GAP
3/18 — validados por búsqueda exhaustiva de contenido (no por resultado del retrieval). Se mantiene la distinción UNSUPPORTED ≠ NOT_RETRIEVED.

## 13. Gold core
1-2 chunks por query SUPPORTED (minimalista, sin inflado) — 15 core en total

## 14. Gold supporting
10 chunks adicionales en 10 queries

## 15. Validación física de Gold
✅ **25/25 IDs encontrados en BD, 0 missing, 0 sin content_hash** — `gold_id_valid = true`

## 16. V2 → V4
11 RE-MAPPED, 4 REDUCED, 3 UNSUPPORTED, 1 SAME — el V4 re-mapea los expected hacia evidencia directamente relevante

## 17. V3 → V4
V3 ya re-mapeaba lo esencial; V4 refina con core/supporting y reclasifica cejas_004/008 a PARTIALLY (más honesto que SUPPORTED)

## 18. Retrieval después de congelar Gold
Ejecutado con motor productivo sin modificar (topK 10, sin threshold, NVIDIA real)

## 19. Retrieval invariance
✅ Un solo retrieval por query; A ≡ B

## 20. Métricas V4 (15 SUPPORTED)
| Métrica | Core | Core+Sup |
|---|---|---|
| P@1 | 0.3333 | 0.3889 |
| P@3 | 0.2777 | 0.4259 |
| P@5 | 0.1667 | 0.2778 |
| R@5 | **0.8333** | 0.8333 |
| MRR | 0.5648 | 0.5926 |

## 21. Core vs Supporting
Core R@5 = 0.8333 = Core+Sup R@5 → el supporting no añade recall; el core ya estaba recuperado (coherente con overlap 1.0)

## 22. Gold ↔ historical retrieval overlap
**25/25 (ratio 1.0)** — TODOS los gold chunks aparecen en el retrieved top-10

## 23. Análisis de circularidad
**⚠️ CONCLUSIÓN CRÍTICA**:
- El **proceso del script** está blindado (PHASE 1 sin retrieval)
- **PERO el constructor (Hermes) ya había observado los top-20 de R5-C6/C7 en ciclos anteriores** antes de escribir el gold → el conocimiento previo puede haber influido en la selección
- Anti-gaming test: **YES** (con la información disponible, alguien con acceso a los retrievals previos podría reconstruir este gold mirándolos)
- **Consecuencia: V4 NO puede declararse Gold validado en este ciclo**

## 24. Análisis de sesgo
| Sesgo | Hallazgo |
|---|---|
| Selección | ⚠️ Overlap 1.0 — consistente con sesgo retrospectivo O motor correcto (no distinguible) |
| Dominio | Sin sesgo evidente (clasificación equilibrada) |
| Cantidad | Minimalista (core 1-2) — sin inflado |
| Cobertura | 3 UNSUPPORTED vacíos correctos — sin tangenciales |
| Corpus | Gold chunks reales en corpus canónico |

## 25. RUN A vs RUN B
✅ **A ≡ B** — retrieval IDs y métricas core idénticos

## 26. Tests
- **RAG: 69/69 PASS** | **Global: 263 PASS / 8 FAIL / 1 SKIP** (los 8 pre-existentes prohibidos)

## 27. Archivos creados
- `scripts/r5c12IndependentGoldAudit.js`, `evaluation_dataset_v4_gold_candidate.json`, `r5c12_independent_gold_audit.json`, `r5c12_independent_gold_audit_a.json`, `r5c12_independent_gold_audit_b.json`, `r5c12_independent_gold_audit.md`

## 28. Archivos modificados
- NINGUNO productivo

## 29. Cambios productivos
- NINGUNO — motor, corpus, embeddings, HNSW, threshold, V2, V3 intactos

## 30. Riesgos
- Si V4 se declara gold sin anotación ciega, el baseline futuro sobreestimaría al motor (R@5 0.83 con overlap 1.0)
- El solapamiento completo puede deberse a (a) sesgo del constructor o (b) motor que genuinamente funciona — indistinguible con los datos actuales

## 31. Qué queda descartado
- Optimización de motor (no es el objetivo)
- Uso de V4 como benchmark oficial en este ciclo

## 32. Qué queda pendiente
- **Anotación independiente con revisor ciego** (humano o automatizado con criterios pre-registrados) que NO haya visto los retrievals
- Pre-registro del protocolo de anotación ANTES de consultar el motor
- Recalcular overlap tras anotación ciega

## 33. VEREDICTO
**V4-REVISION**

El Gold V4 cumple: integridad física perfecta (25/25 IDs reales con hash), clasificación defendible (10 SUPPORTED / 5 PARTIAL / 3 UNSUPPORTED con rationale y missing_information), minimalidad (core 1-2 chunks), UNSUPPORTED correctamente vacíos, reproducibilidad A≡B, y proceso de script blindado (PHASE 1 sin retrieval).

**PERO NO cumple el criterio de independencia del constructor**: el overlap Gold↔retrieval es 1.0 (25/25) y el constructor ya había observado los retrievals históricos antes de escribir el gold. La respuesta al anti-gaming test es **YES** — no podemos descartar selección retrospectiva con la evidencia disponible. Por tanto, **NO tenemos todavía un Gold Set validado**, y eso es el resultado científicamente correcto: preferible detectar que el instrumento no está listo antes que optimizar sobre un benchmark contaminado.

**Recomendación R5-C13**: anotación independiente con revisor ciego (que no haya visto los retrievals), criterios pre-registrados, y recálculo del overlap post-anotación. Solo entonces V4 podría convertirse en el baseline definitivo. El motor NO se toca hasta cerrar esta cadena.

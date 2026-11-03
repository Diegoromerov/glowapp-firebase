# INFORME HERMES — CICLO 42 — R5-C30
# FINAL CEILING VALIDATION & PRODUCTION DECISION

## 1. Objetivo
Ciclo final de consolidación: convertir 41 ciclos de evidencia experimental en una decisión arquitectónica técnicamente defendible para Aura/Glow IA+. NO busca nueva técnica — determina el techo real del RAG y qué debe pasar a producción.

## 2. Matriz causal final (18 queries)
| Clase | Queries | % |
|---|---|---|
| DIRECT_SUCCESS | 12 (7 skincare, 3 cabello, 2 cejas) | 66.7% |
| MULTI_CHUNK_RECOVERABLE | 2 (cabello_002, cejas_008) | 11.1% |
| CORPUS_GAP | 3 (cabello_004, cejas_002, cejas_003) | 16.7% |
| RETRIEVAL_MISS | 1 (cejas_004) | 5.6% |
| ANNOTATION | 0 | 0% |
| **Suma** | 18 | **100%** |

## 3. Error budget final
- **RETRIEVAL-attributable: 16.7%** (2 multi-chunk + 1 miss puro)
- **CORPUS-attributable: 16.7%** (3 UNSUPPORTED)
- **ANNOTATION: 0%**

## 4. Techos (tres niveles, NO confundir)
| Nivel | Valor | Qué mide |
|---|---|---|
| R@5 baseline | 0.7885 | chunks gold en top-5 (motor actual) |
| R@100 vectorial | 0.8011 | chunks gold recuperables ampliando K (techo del pool) |
| **Evidence ceiling** | **0.9333** | queries cuyos expected están en el pool (respondibles SI la composición funcionara) |
| Respuesta correcta | ~0.79 | adicionalmente requiere composición (NO lograda) + generación |

**R@50/R@100 ≠ evidence ceiling ≠ respuesta correcta** — son tres niveles distintos que los 41 ciclos separaron experimentalmente.

## 5. Casos críticos (clasificación definitiva)
- **cejas_004 → RETRIEVAL_MISS**: evidencia EXISTE en corpus (55/55 golds en BD) pero 4/6 piezas fuera de top-100 por colisión semántica. No es corpus gap. No recuperable por ninguna técnica probada (C22-C29). **Límite documentado.**
- **cabello_002 → MULTI_CHUNK_RECOVERABLE**: 3/5 piezas en top-50; composición teórica posible pero no activable con señales del motor (C28/C29 DISCONFIRMED). C25 la recuperó con agregador indiscriminado (no generalizable).
- **cejas_008 → MULTI_CHUNK_RECOVERABLE**: 3/6 piezas en top-50; piezas de remoción fuera; misma limitación.

## 6. Producción — recomendación arquitectónica
**SAFE TO IMPLEMENT** (2):
1. Baseline R5-C actual (retrieval e5-v5, threshold 0.45, top-5) — ya en producción, sin cambios
2. **Política UNSUPPORTED vs RETRIEVAL MISS** — distinguir "el corpus no tiene la evidencia" (UNSUPPORTED) de "la evidencia existe pero no se recuperó" (RETRIEVAL MISS) usando el inventario de corpus de C27

**NOT JUSTIFIED** (7): cambio de modelo, reranking, query representation, representación documental, routing adaptativo (léxico+semántico), suficiencia léxica, hybrid simple

**EXPERIMENTALLY PROMISING** (pero NO productivas aún): gate strong_score≥0.55 (requiere validación independiente); composición multi-chunk (requiere señal externa)

## 7. DECISIÓN FINAL
**R5-C30 — DECISIÓN C: CORPUS-FIRST**

El corpus-attributable (16.7%) es un cuello de botella EQUIVALENTE al retrieval-attributable (16.7%), pero el retrieval llegó a un techo defendible (R@100=0.80, 9 líneas cerradas con evidencia reproducible) mientras el corpus gap (3 UNSUPPORTED) es una decisión de negocio con beneficio directo del 16.7%.

**Complemento: D (RETRIEVAL-RESEARCH-CLOSED)** — la investigación de retrieval tiene techo defendible documentado.

**NO recomendado**: PROCEED-TO-PRODUCTION de agregadores/routers (evidencia insuficiente).

## 8. Respuesta a las preguntas del Director
**¿Cuál es el techo del RAG actual?** R@5=0.7885 (motor), R@100=0.8011 (pool vectorial), evidence ceiling 0.9333 (teórico con composición perfecta, NO alcanzable con señales del motor actual).

**¿Intervención mínima segura?** (1) Mantener el motor intacto; (2) implementar política UNSUPPORTED basada en inventario de corpus (C27); (3) ampliar corpus para las 3 UNSUPPORTED (decisión de negocio, +16.7% potencial). Nada más está respaldado por evidencia.

## 9. Tests e integridad
- RAG: 69/69 PASS | Global: 263/8/1 (pendiente verificación final)
- BD intacta (5,663/0 NULL/1024d), solo lectura de artefactos, guarda anti-producción activa
- Reproducibilidad: RUN A ≡ RUN B (consolidador determinista)
- Motor productivo INTACTO; Railway NO contactada; sin commits

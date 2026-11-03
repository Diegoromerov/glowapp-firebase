# INFORME HERMES — CICLO 39 — R5-C27
# ERROR BUDGET / RETRIEVAL MISS vs CORPUS GAP

## 1. Objetivo
Cambiar de nivel: NO mejorar R@5 — explicar por qué no es mayor. Descomponer cuantitativamente el error del RAG sobre GOLD-V5 en éxito de retrieval, evidencia multi-chunk, retrieval miss, corpus gap y problemas de anotación, separando rigorosamente "no recuperé el chunk" de "el corpus no contiene la información".

## 2. Diseño (FASE 2)
- **Comprobación de corpus**: los 55 gold IDs re-verificados en BD (55/55 presentes) → CORPUS GAP solo si la evidencia es semánticamente insuficiente (UNSUPPORTED validados en R5-C13); RETRIEVAL MISS si existe pero está insuficientemente recuperada
- **Clasificación determinista**: A_DIRECT_SUCCESS (≥50% golds top-5) / B_MULTI_CHUNK_RECOVERABLE (≥50% top-50, no top-5) / C_RETRIEVAL_MISS (<50% top-100 con evidencia en corpus) / D_CORPUS_GAP (UNSUPPORTED) / E_ANNOTATION_GAP (sin asignaciones)
- **Sin gold leakage**: gold solo para evaluación; localización vía BD/corpus

## 3. Resultados (RUN A ≡ RUN B, determinista)
| Categoría | Queries | % |
|---|---|---|
| A_DIRECT_SUCCESS | 12 | 66.7% |
| B_MULTI_CHUNK_RECOVERABLE | 2 (cabello_002, cejas_008) | 11.1% |
| C_RETRIEVAL_MISS | 1 (cejas_004) | 5.6% |
| D_CORPUS_GAP | 3 (cabello_004, cejas_002, cejas_003) | 16.7% |
| E_ANNOTATION_GAP | 0 | 0% |

**RETRIEVAL-attributable: 16.7% | CORPUS-attributable: 16.7% | ANNOTATION: 0%**

## 4. Los 3 misses (diagnóstico completo)
| Miss | Clasificación | Evidencia | Conclusión |
|---|---|---|---|
| **cabello_002** | B_MULTI_CHUNK | 2/5 top-5, 3/5 top-50 | Error de **composición**: evidencia completa disponible y componible |
| **cejas_008** | B_MULTI_CHUNK | 2/6 top-5, 3/6 top-50 | Error de **composición** (límite del umbral) |
| **cejas_004** | C_RETRIEVAL_MISS | 2/6 top-100, **4 FUERA** | **CONFIRMADO cuantitativamente**: las 4 piezas de simetría muscular EXISTEN en BD pero están fuera de top-100 — colisión semántica, no corpus gap |

## 5. Respuesta a la pregunta del Director
**"¿Cuáles errores son recuperables por ingeniería del retrieval y cuáles solo por mejorar el corpus?"**

- **Recuperables por ingeniería**: 3/18 (16.7%) — cabello_002 y cejas_008 (composición de evidencia YA recuperada) + cejas_004 (único miss puro, requiere representación distinta)
- **Solo con más corpus**: 3/18 (16.7%) — las UNSUPPORTED (contenido nuevo necesario)
- **Incluso con retrieval perfecto**: el techo sería ~83-89%; el 100% es inalcanzable sin ampliar corpus y resolver la colisión de cejas_004

## 6. VEREDICTO
**R5-C27 — ERROR-BUDGET-MIXED**

El techo del RAG se explica con **pesos IGUALES** de dos factores: retrieval-attributable 16.7% (2 multi-chunk componibles + 1 miss puro) y corpus-attributable 16.7% (3 UNSUPPORTED). El 66.7% es éxito directo. **NO hay palanca única dominante** — el déficit es estructuralmente mixto.

**Lo más revelador**: solo **1 de 18 queries (5.6%)** es un retrieval miss puro (cejas_004). La mayor parte del déficit recuperable es composición de evidencia ya recuperada (11.1%), y una parte igual es corpus gap (16.7%).

## 7. Recomendación exacta para R5-C28
1. **No hay palanca única**: el error budget está equilibrado entre retrieval (16.7%) y corpus (16.7%)
2. El déficit más barato (composición de cabello_002/cejas_008) ya fue intentado en C25/C26 sin generalizar con señales léxicas → se necesitaría señal semántica (riesgo alto, beneficio 11.1%)
3. cejas_004 (5.6%) requiere representación estructural distinta o aceptación documentada
4. El corpus gap (16.7%) es decisión de negocio (ampliar contenido)
5. **Recomendación honesta**: aceptar el baseline R5-C (R@5=0.7885) como techo del motor actual con este corpus; documentar el mapa causal; decisión del Director entre (a) ampliar corpus, (b) invertir en composición semántica, (c) cerrar la investigación R5-C

## 8. Tests e integridad
- RAG: 69/69 PASS | Global: 263/8/1 (pendiente verificación final)
- BD intacta (5,663/0 NULL/1024d), 55/55 golds re-verificados, solo SELECT, guarda anti-producción activa
- Reproducibilidad: RUN A ≡ RUN B (clasificación, evidencia, ranks, error budget idénticos)

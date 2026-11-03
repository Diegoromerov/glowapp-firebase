# INFORME HERMES — CICLO 41 — R5-C29
# SEMANTIC EVIDENCE ROUTING EXPERIMENT

## 1. Objetivo
Determinar si las señales SEMÁNTICAS del retrieval actual (scores, márgenes, densidad, diversidad) pueden distinguir de forma reproducible cuándo una query necesita composición multi-chunk — sin gold leakage, sin reordenar, sin tocar el motor.

## 2. Diseño (FASE 2)
**CONTROLES**: A = baseline top-5; B = LEXICAL routing (regla C28 exacta); C = SEMANTIC routing (regla nueva).

**Señales semánticas** (11): score_top1/2/3, margin12, margin13, score_drop_12, score_mean_top5, score_std_top5, density_top3, diversity_top5, concentration.

**Regla semántica PRE-REGISTRADA**: ACTIVATE si margin12 < 0.02 AND density_top3 ≥ 3 AND top1 ≥ 0.45. Gate anti-falso-SUFFICIENT heredado (strong_score ≥ 0.55).

## 3. Resultados (RUN A ≡ RUN B, determinista)
| Métrica | A | B (léxico) | C (semántico) |
|---|---|---|---|
| Activación | — | 26.7% | **86.7%** |
| Query success | 1.0 | 0.8 | **0.5333** |
| Precision | — | 0.3633 | 0.3922 |
| False-sufficient | — | 2 | 3 |
| Regresiones | — | 3 | **7** |

**Matriz de confusión** (real = cabello_002 + cejas_008):
- SEMÁNTICA: TP=2, **FP=11**, TN=2 (precision 0.15, recall 1.0 trivial)
- LÉXICA: TP=0, FP=4, TN=9

## 4. Estadísticas de señales (descriptivas, sin tuning)
| Señal | Multi-chunk | Resto | ¿Discrimina? |
|---|---|---|---|
| margin12 | 0.0082 | 0.0094 | **NO** |
| score_drop_12 | 0.0145 | 0.0166 | **NO** |
| density_top3 | 20.0 | 12.9 | SÍ pero no informativa |
| concentration | 1.0194 | 1.0323 | **NO** |
| diversity_top5 | **1.0** | 2.23 | SÍ pero **CONTRARIA** a la hipótesis |

## 5. Hallazgo central
**La banda de scores 0.50-0.58 está tan comprimida** (colisión semántica del dominio, C17) que TODAS las queries tienen el mismo perfil de distribución: margen pequeño, densidad alta, scores similares. Las señales de scores no pueden distinguir tipos de query.

**La única señal discriminativa (diversity_top5) apunta en dirección CONTRARIA**: las queries multi-chunk tienen MENOS diversidad de dominios (sus piezas vienen del mismo documento: colorimetría_capilar para cabello_002, visajismo para cejas_008), no más.

## 6. Los 3 misses
| Miss | Routing | Resultado |
|---|---|---|
| **cabello_002** | COMPOSE | SUFFICIENT ✓Q — recuperado, pero por **activación indiscriminada** (FP de routing), no por capacidad discriminativa |
| **cejas_008** | COMPOSE | PARTIAL — no recuperado |
| **cejas_004** | COMPOSE | **PARTIAL, GATE OK** — no falso SUFFICIENT (strong_score≥0.55 funciona) |

## 7. VEREDICTO
**R5-C29 — SEMANTIC-ROUTING-DISCONFIRMED**

**Demostrado**: el gate strong_score≥0.55 sigue evitando el falso SUFFICIENT de cejas_004 (tercer ciclo consecutivo — hallazgo robusto).

**Refutado**: que las señales semánticas del retrieval actual discriminen entre queries multi-chunk y directas. La colisión semántica comprime la distribución de scores y la diversidad de dominios apunta al revés. El router semántico activa en 86.7% con 11 falsos positivos y 7 regresiones.

## 8. Línea cerrada
**C28 (léxico) + C29 (semántico) = routing adaptativo DESCARTADO con evidencia reproducible.** Las señales del motor actual (léxicas o de scores) no pueden decidir cuándo componer.

## 9. Recomendación exacta para R5-C30
1. **CERRAR la línea de routing adaptativo**
2. Conservar el gate strong_score≥0.55 como hallazgo documentado (no threshold productivo sin aprobación)
3. La evidencia C15-C29 converge: el déficit multi-chunk requiere señal semántica EXTERNA (fuera del alcance actual) o aceptar el techo
4. Decisión del Director: (a) aceptar baseline R5-C como techo y cerrar R5-C con el mapa causal de C27; (b) ampliar corpus (beneficio 16.7%); (c) señal semántica externa (riesgo alto)

## 10. Tests e integridad
- RAG: 69/69 PASS | Global: 263/8/1 (pendiente verificación final)
- BD intacta (5,663/0 NULL/1024d), solo SELECT, guarda anti-producción activa
- Reproducibilidad: RUN A ≡ RUN B (señales, decisiones, clases idénticos)

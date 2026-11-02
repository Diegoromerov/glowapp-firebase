# INFORME HERMES — CICLO 40 — R5-C28
# CONTROLLED EVIDENCE ROUTING / SELECTIVE MULTI-CHUNK

## 1. Objetivo
Determinar si un router SELECTIVO (que activa composición de evidencia solo con señales objetivas) puede explotar el 16.7% retrieval-attributable (cabello_002, cejas_008) sin degradar el 66.7% que ya funciona ni producir falsos SUFFICIENT (cejas_004).

## 2. Diseño (FASE 2)
**Arquitectura**: RETRIEVE → ASSESS (señales) → ROUTE (NORMAL | COMPOSE) → EVIDENCE.

**Router (parámetros PRE-REGISTRADOS, sin tuning sobre Gold)**:
- Señales: top1_score, margin12, query_coverage_top5, complement_count, score_concentration, domain_diversity
- **Activación**: cov5 < 0.6 AND complement_count ≥ 2 AND top1 ≥ 0.45
- **Gate anti-falso-SUFFICIENT** (lección C26): SUFFICIENT requiere cobertura ≥0.5 Y ≥2 chunks Y ≥1 chunk con score ≥0.55 (límite superior de la banda de colisión 0.50-0.58)

**Controles**: A = baseline top-5; B = agregación indiscriminada (C25); C = routing selectivo

## 3. Resultados (RUN A ≡ RUN B, determinista)
| Métrica | A | B | C |
|---|---|---|---|
| Query success | 1.0 | 0.4667 | 0.8 |
| Precision | — | 0.3611 | 0.3633 |
| False-sufficient | — | 3 | **2** |
| Activation rate | — | — | 0.2667 (4/15) |
| Regresiones C vs A | — | — | **3** (skincare_009, cejas_004, cejas_007) |

## 4. Los 3 misses
| Miss | Router | Resultado |
|---|---|---|
| **cabello_002** | NORMAL (no activó) | **NO recuperado** — complement_count=1 < 2; la señal no detecta evidencia distribuida cuando el mejor chunk cubre el vocabulario |
| **cejas_008** | NORMAL (no activó) | **NO recuperado** — misma falla de señal |
| **cejas_004** | COMPOSE → PARTIAL | **GATE OK — ya NO es falso SUFFICIENT** (C25: SUFFICIENT falso → C28: PARTIAL). Mejora real del control negativo |

## 5. Hallazgo clave
**La señal complement_count es estructuralmente incapaz** de detectar evidencia multi-chunk: mide chunks que aportan términos NUEVOS de query respecto al mejor chunk, pero en cabello_002/cejas_008 el chunk principal (rank 1, score ~0.55) ya cubre el vocabulario — los chunks complementarios (ph, viscoelasticidad, remoción) aportan PIEZAS de evidencia pero no términos nuevos. La señal mira el vocabulario, no la evidencia.

**El gate strong_score≥0.55 es el único hallazgo reutilizable**: corrige el falso SUFFICIENT de cejas_004 de forma determinista.

## 6. VEREDICTO
**R5-C28 — CONTROLLED-ROUTING-DISCONFIRMED**

**Criterios de éxito**: A) NO recuperó ningún multi-chunk real; B) NO — 3 regresiones; C) PARCIAL — 2 falsos SUFFICIENT (menos que B=3, cejas_004 corregido); D) SÍ — precision sin degradación (0.3633); E) SÍ — A≡B.

**Demostrado**: el gate anti-falso-SUFFICIENT (score ≥0.55) funciona — cejas_004 pasó de SUFFICIENT falso (C25) a PARTIAL.

**Refutado**: que la activación selectiva basada en señales léxicas de cobertura detecte y explote los casos multi-chunk — no activó en los casos objetivo y contamina al activar en skincare_009/cejas_007.

## 7. Recomendación exacta para R5-C29
1. **CERRAR la línea de routing selectivo léxico** (evidencia negativa reproducible)
2. **Conservar el gate strong_score≥0.55** como regla de seguridad reutilizable
3. Con C25/C26/C28 descartados: el déficit multi-chunk NO es explotable con señales léxicas deterministas — requiere señal semántica (embedding de rol por pieza) o aceptar el techo
4. Decisión del Director: (a) aceptar baseline R5-C como techo y cerrar la investigación con el mapa causal de C27; (b) autorizar señal semántica (riesgo alto); (c) ampliar corpus (decisión de negocio)

## 8. Tests e integridad
- RAG: 69/69 PASS | Global: 263/8/1 (pendiente verificación final)
- BD intacta (5,663/0 NULL/1024d), solo SELECT, guarda anti-producción activa
- Reproducibilidad: RUN A ≡ RUN B (decisiones, clases, precision, señales idénticos)

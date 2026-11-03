# INFORME HERMES — CICLO 37 — R5-C25
# EVIDENCE AGGREGATOR EXPERIMENT

## 1. Objetivo
Determinar si un **Evidence Aggregator general** (agrupación + complementariedad + deduplicación + scoring) puede transformar candidatos recuperados individualmente en un conjunto de evidencia suficiente para responder, sin contaminación significativa por hard negatives — validando (o refutando) la Evidence Layer entre retrieval y generación.

## 2. Diseño (FASE 2)
**Arquitectura**: QUERY → RETRIEVAL (sin tocar) → CANDIDATE POOL (top-100) → EVIDENCE UNITS → COMPLEMENTARITY → EVIDENCE GROUPS → REDUNDANCY CONTROL → SUFFICIENCY → FINAL EVIDENCE SET.

**Controles**: A = baseline top-5 sin agregar; B = reproducción R5-C24 (14/15); C = ORACLE_ONLY (techo, marcado); D = agregador real (solo query + pool + metadata, SIN gold).

**Mecanismo del agregador** (determinista, sin LLM):
- Units: función informativa (señales léxicas) + cobertura de términos de la query
- Complementariedad: REDUNDANT si overlap léxico ≥0.3; COMPLEMENTARY si cubren términos DISTINTOS de la query (NO suma ciega de scores)
- Grupos greedy desde el mejor chunk; descarta redundantes; excluye chunks sin cobertura
- Suficiencia (sin gold): cobertura de query ≥0.5 y ≥2 chunks → SUFFICIENT; 0.2-0.5 → PARTIAL; sin evidencia → VECTOR_MISS
- Evaluación post-hoc (solo métrica): precision, recall, contaminación, query success

## 3. Resultados (RUN A ≡ RUN B, determinista)
| Métrica | Valor |
|---|---|
| Query success (agregador) | **0.5333 (8/15)** |
| Evidence precision media | **0.3611** |
| Contaminación (cobertura) | 0.0 |
| Clases | SUFFICIENT=12, INSUFFICIENT=1, PARTIAL=2 |
| Control B (R5-C24) | 14/15 ✓ |
| Oracle | 14/15 |

## 4. Los 3 misses
| Miss | Agregador | Q_success | Precision | Conclusión |
|---|---|---|---|---|
| **cabello_002** | SUFFICIENT | ✅ True | 0.50 | **RECUPERADO** — ph-pos-tinte-009 (gold) + degradación-lipidos |
| **cejas_008** | PARTIAL | ❌ False | 0.50 | No recuperado — solo 1 gold de 6; piezas de remoción fuera |
| **cejas_004** | SUFFICIENT (falso) | ❌ False | **0.00** | **Control negativo VALIDADO en lo esencial**: no fabrica gold (Q=False), pero la clasificación SUFFICIENT es un falso positivo (cobertura léxica 0.75 con 3 chunks no-gold) |

## 5. Hallazgo central
**La cobertura léxica de query es una señal de complementariedad DEMASIADO DÉBIL**:
- Precision 0.36: solo 1/3 de la evidencia seleccionada es gold → ~64% son hard negatives **con vocabulario compartido** (la colisión semántica del dominio, R5-C17)
- El falso SUFFICIENT de cejas_004 lo demuestra: 3 chunks con cobertura 0.75 pero 0 gold
- El agregador funciona SOLO cuando la query tiene términos distintivos que la evidencia correcta comparte de forma exclusiva (patrón cabello_002)

## 6. VEREDICTO
**R5-C25 — AGGREGATOR-MIXED**

**Demostrado**: el fenómeno de evidencia distribuida componible existe y un mecanismo determinista puede reunirla en casos con vocabulario distintivo (cabello_002 recuperado; techo de respondibilidad 14/15 reproduce R5-C24).

**Refutado**: la generalización — cobertura léxica como señal de suficiencia no distingue hard negatives del mismo dominio (precision 0.36; 4 queries con precision 0: skincare_006, skincare_009, cejas_004, cejas_007; query success 53% < baseline 79%).

**Abierto**: un agregador productivo necesitaría una señal de complementariedad más fuerte (facetas por dominio, embeddings de rol, scoring de cobertura estructural) — no probado en este ciclo.

**Regresiones**: 7/15 con Q=False — como capa universal, el agregador actual DEGRADARÍA respecto al baseline.

## 7. Recomendación exacta para R5-C26
1. **NO integrar** el agregador en producción (evidencia negativa de generalización)
2. El patrón cabello_002 demuestra valor potencial, pero la señal actual es insuficiente
3. Decisiones del Director: (a) refinar con señal de complementariedad más fuerte (evidencia aún insuficiente), (b) aceptar el techo del motor (baseline R5-C) y cerrar la línea de evidence layer, (c) documentar cejas_004 como límite de cobertura léxica
4. GOLD-V5, baseline R5-C y motor productivo intactos; Railway NO contactada

## 8. Tests e integridad
- RAG: 69/69 PASS | Global: 263/8/1 (pendiente verificación final)
- BD intacta (5,663/0 NULL/1024d), solo SELECT, guarda anti-producción activa
- Reproducibilidad: RUN A ≡ RUN B (clase, tamaño, cobertura, precision, success idénticos)

# INFORME HERMES — CICLO 35 — R5-C23
# DIAGNÓSTICO DE COBERTURA MULTI-CHUNK Y EVIDENCIA COMPUESTA

## Qué se probó
Si los misses residuales del RAG son un problema de recuperación de chunks individuales, o si el conocimiento correcto ya está distribuido entre varios chunks (evidencia compuesta) y el sistema no sabe reunirlo. Se evaluó sobre todo GOLD-V5 (15 queries no-UNSUPPORTED) con pools vectoriales top-5/10/20/50/100, clasificación determinista de suficiencia de evidencia (≥50% de expected chunks en el pool K, sin LLM), y análisis por pieza de los 3 misses.

## Resultados clave

### 1. Techos
| Techo | Valor | Significado |
|---|---|---|
| Baseline R5-C (R@5) | 0.7885 | sistema actual |
| Direct R@100 | 1.0 | 15/15 queries con ≥1 gold en top-100 |
| Evidence R@100 | 0.8011 | proporción de TODOS los expected chunks en el pool |
| **Evidence ceiling @100** | **0.9333** | **14/15 queries respondibles SI el sistema compusiera la evidencia** |

**El conocimiento está en el corpus**: 93% de las queries tendrían evidencia compuesta suficiente en top-100. El techo del sistema (0.7885) está muy por debajo del techo de evidencia (0.9333).

### 2. Los 3 misses — diagnóstico por piezas
| Miss | Mejor gold | Evidencia @50 | Piezas presentes | Piezas ausentes | Tipo |
|---|---|---|---|---|---|
| cabello_002 | rank 1 | 0.60 | 3/5 (ph-001, ph-pos-tinte, viscoelasticidad) | SERS, metales | **MULTI_CHUNK_PARCIAL** |
| cejas_004 | rank 2 | 0.33 | 2/6 (dispersión luz, metamerismo) | **4/6 simetría muscular** | **VECTOR_MISS** |
| cejas_008 | rank 1 | 0.50 | 3/6 (interacción láser, piel-grasa, autoinmunes) | electrólisis, erbio, tyndall | **MULTI_CHUNK_PARCIAL** |

### 3. Hallazgo crítico
- **cabello_002 y cejas_008**: la evidencia compuesta SÍ está en top-50 (3/5 y 3/6 piezas) — **un sistema de evidence aggregation podría responderlas**. El RAG actual recupera el gold principal (rank 1) pero no reúne las piezas complementarias.
- **cejas_004**: recall **PLANO 0.33 de @5 a @100** — las 4 piezas de simetría muscular no entran ni en top-100. **Ni la composición puede ayudar** — es colisión vectorial pura (VECTOR_MISS).

### 4. Clasificación causal (por piezas)
- DIRECT_SUCCESS: 12/15
- MULTI_CHUNK_PARCIAL: 2/15 (cabello_002, cejas_008)
- VECTOR_MISS: 1/15 (cejas_004)

### 5. Análisis cejas (heterogéneo, no problema único)
- cejas_001, cejas_005, cejas_007: DIRECT_SUCCESS
- cejas_008: MULTI_CHUNK_PARCIAL (remoción distribuida en top-50)
- cejas_004: VECTOR_MISS (simetría muscular fuera de top-100)
- cejas_002, cejas_003: UNSUPPORTED (corpus gap validado)

## VEREDICTO
**MIXED**

Los misses son de **dos tipos distintos**:
1. **MULTI-CHUNK PARCIAL** (cabello_002, cejas_008): el conocimiento correcto YA está distribuido en top-50 — el RAG no lo reúne. **Evidence aggregation SÍ tendría justificación** para estos casos.
2. **VECTOR MISS** (cejas_004): 4/6 piezas fuera de top-100 — la composición NO puede ayudar; requiere representación distinta o aceptación del límite.

## Respuesta a la pregunta del Director
"¿Los misses son un problema de recuperación de chunks individuales, o el conocimiento ya está distribuido?"

**Ambos, con peso desigual**: para 2/3 misses (cabello_002, cejas_008), el conocimiento está distribuido y es re-usable en top-50 — el RAG simplemente no sabe reunirlo (confirma la hipótesis multi-chunk). Para 1/3 (cejas_004), el problema es de recuperación vectorial pura (la evidencia ni siquiera entra al pool).

## Recomendación exacta para R5-C24
1. **R5-C24**: experimento controlado de **evidence aggregation / query decomposition** SIN tocar producción — componer top-50 (2+ piezas complementarias) y medir si responde correctamente cabello_002 y cejas_008
2. **cejas_004**: NO es multi-chunk recoverable — excluir de la hipótesis de composición; queda como límite documentado (colisión vectorial) o candidato a representación estructural distinta
3. El **evidence ceiling (0.9333)** es el techo teórico si la composición funcionara — el delta frente al baseline (0.7885) es el espacio de mejora máximo: ~0.145
4. GOLD-V5 y baseline R5-C intactos; motor productivo sin modificar

## Tests e integridad
- **RAG: 69/69 PASS** | **Global: 263 PASS / 8 FAIL / 1 SKIP** (los 8 pre-existentes prohibidos)
- BD intacta (5,663/0 NULL/1024d), Railway NO contactada, solo SELECT + cálculo en memoria
- Reproducibilidad: RUN A ≡ RUN B (ranks, evidence, clasificación y chunks idénticos)

# INFORME HERMES — CICLO 36 — R5-C24
# EXPERIMENTO CONTROLADO DE EVIDENCE AGGREGATION

## Qué se probó
Si una estrategia de agregación de evidencia puede convertir la evidencia distribuida (identificada en R5-C23) en recuperación útil, sin tocar el motor productivo. Se evaluó sobre GOLD-V5 (15 queries no-UNSUPPORTED) con pools top-5/10/20/50/100, clasificación funcional determinista (sin LLM), composición con umbral de suficiencia ≥50% de expected chunks, y control negativo.

## Resultados clave

### 1. Clasificación final (por evidencia completa)
| Clase | Queries | Detalle |
|---|---|---|
| DIRECT_SUCCESS | 12 | evidencia suficiente en top-5 |
| MULTI_CHUNK_RECOVERED | 2 | cabello_002, cejas_008 (evidencia en top-50) |
| MULTI_CHUNK_PARTIAL | 1 | cejas_004 (0.33 plano @5→@100) |

### 2. Los 3 misses
| Query | Direct | Multi-chunk | Resultado |
|---|---|---|---|
| cabello_002 | ❌ (R@5=0.4) | **✅ RECOVERED @50** (0.6, 3/5 piezas) | La agregación de 3 piezas (ph-001, ph-pos-tinte, viscoelasticidad) la haría respondible |
| cejas_008 | ❌ (R@5=0.33) | **✅ RECOVERED @50** (0.5, 3/6 piezas) | Límite exacto del umbral; 3 piezas (láser, piel-grasa, autoinmunes) la harían respondible |
| cejas_004 | ❌ (R@5=0.33) | **❌ PARTIAL/VECTOR_MISS** (0.33 plano) | **Control negativo VALIDADO**: la agregación NO fabrica evidencia ausente (4/6 piezas de simetría fuera de top-100) |

### 3. AggregationGain
- Negativo en términos de recall del pool (−0.38 @5, −0.20 @50) porque el pool es fijo — la agregación no añade chunks
- **Positivo en términos de respondibilidad: +2 queries** → 14/15 = 0.9333 = **exactamente el evidence ceiling de R5-C23**
- La ganancia de la agregación es convertir chunks YA recuperados en capacidad de respuesta, no mejorar el retrieval

### 4. Control negativo (cejas_004)
Recall **plano 0.3333 de @5 a @100** con 4/6 piezas ausentes — la composición no puede inventar evidencia. **Confirma VECTOR_MISS real** y valida el método (la agregación no es un truco que fabrica respuestas).

### 5. Respuesta a la pregunta del Director
"¿La agregación convierte los chunks que ya recuperamos en respuestas recuperables, o el techo ~0.80 es fundamentalmente candidate retrieval?"

**Ambos, con peso 2:1.** Para 2/3 misses (cabello_002, cejas_008) la evidencia distribuida en top-50 SÍ es componible → la agregación los convertiría en respondibles. Para 1/3 (cejas_004) el problema es candidate retrieval puro (evidencia fuera del pool). El techo del POOL (0.80) no sube con agregación; el techo de RESPONDIBILIDAD sube a 0.9333.

## VEREDICTO
**AGGREGATION-MIXED**

La agregación de evidencia ayuda a 2 de los 3 misses (los que tienen evidencia compuesta distribuida en top-50) pero no resuelve el VECTOR_MISS real de cejas_004. La estrategia tiene justificación para el subconjunto multi-chunk, pero no es una solución estructural al déficit completo.

## Recomendación exacta para R5-C25
1. **Diseñar Evidence Aggregator controlado** (NO productivo): recuperación top-50 + clustering funcional (PRIMARY/SECONDARY/CONDITION/CONTRAINDICATION/EXCEPTION/PROCEDURE) + composición determinista — demostrar que cabello_002 y cejas_008 se responden correctamente con piezas ya recuperadas
2. **cejas_004 queda fuera del alcance del aggregator** (VECTOR_MISS confirmado) — requiere representación estructural distinta o aceptación del límite documentado
3. El gain esperado es +2 queries de respondibilidad (0.7885 → 0.9333), NO recall de pool
4. GOLD-V5, baseline R5-C y motor productivo permanecen intactos

## Tests e integridad
- **RAG: 69/69 PASS** | **Global: 263 PASS / 8 FAIL / 1 SKIP** (los 8 pre-existentes prohibidos)
- BD intacta (5,663/0 NULL/1024d), Railway NO contactada, solo SELECT + cálculo en memoria
- Reproducibilidad: RUN A ≡ RUN B (ranks, evidence, clasificación y chunks idénticos)

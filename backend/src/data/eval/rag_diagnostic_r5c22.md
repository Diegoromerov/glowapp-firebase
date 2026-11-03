# INFORME HERMES — CICLO 34 — R5-C22
# EXPERIMENTO DE CANDIDATE POOL / RECALL CEILING

## Qué se probó
Dónde se pierde la evidencia en la cadena: embedding → vector retrieval → candidate pool → rank. Se evaluó el recall del pool vectorial en 5 niveles (top-5/10/20/50/100), el recall ceiling, el diagnóstico léxico y la unión vector+lexical sobre todo GOLD-V5 (15 queries no-UNSUPPORTED).

## Resultados clave

### 1. Recall ceiling vectorial (GOLD-V5 completo)
| K | Recall | MRR |
|---|---|---|
| @5 | 0.6156 | 0.7222 |
| @10 | 0.6545 | 0.7222 |
| @20 | 0.7156 | 0.7222 |
| @50 | 0.8011 | 0.7222 |
| @100 | **0.8011** | 0.7222 |

**Techo del pool = 0.80. R@100 = R@50: ampliar K no añade nada.** MRR idéntico en todos los K → el primer gold siempre aparece en top-5.

### 2. Los 3 misses: la evidencia principal SÍ se recupera
| Miss | Mejor gold rank | R@5 | R@50 | R@100 | Diagnóstico |
|---|---|---|---|---|---|
| cabello_002 | **1** | 0.40 | 0.60 | 0.60 | Golds secundarios fuera hasta 50-100 |
| cejas_004 | **2** | 0.33 | 0.33 | 0.33 | **4/6 golds NI en top-100 (plano)** |
| cejas_008 | **1** | 0.33 | 0.50 | 0.50 | Golds de remoción fuera hasta 50-100 |

**Hallazgo crítico**: los misses NO son "no se recupera la evidencia" — su mejor gold está en TOP5. El déficit está en los **golds de SOPORTE multi-chunk** (los 3 chunks de simetría muscular de cejas_004, los 3 de remoción de cejas_008), que quedan fuera del pool por colisión semántica con chunks del mismo dominio.

### 3. cejas_004 — caso extremo
Recall **plano 0.3333 de R@5 a R@100**: 4 de 6 golds no entran ni en top-100. Los competidores (fotobiología, metamerismo, interferencia electromagnética, colorimetría) ocupan el espacio por proximidad conceptual.

### 4. Diagnóstico léxico
El lexical (TF) NO recupera lo que el vector pierde:
- cejas_004: lexRank=128 (peor que vector)
- cejas_008: lexRank=137 (peor que vector)
- cabello_002: lexRank=3 (pero el vector ya lo tiene en rank 1)

### 5. Unión vector + lexical
**0/15 queries mejoran** — la unión no recupera evidencia adicional en ningún caso. **HYBRID RETRIEVAL NO está justificado.**

### 6. Hard negatives
Los competidores de los 3 misses son **del mismo dominio** (colorimetría capilar / visajismo cejas) con títulos semánticamente adyacentes (microbiota del tinte, equilibrio del pH, metamerismo, psicodermatología, propiocepción). No son ruido irrelevante — son evidencia relacionada que compite por proximidad conceptual.

### 7. Clasificación causal
15/15 queries: **A_VECTOR_SUCCESS** (mejor gold en top-5). Refinamiento: cabello_002 y cejas_008 son B_VECTOR_LATE para golds secundarios; cejas_004 es VECTOR-CANDIDATE-CEILING (4/6 golds >100).

## VEREDICTO
**VECTOR-CANDIDATE-CEILING**

La evidencia se pierde en el **candidate pool** para los golds de soporte multi-chunk: el techo vectorial está en R@50=R@100=0.80; los golds secundarios de los misses no entran ni en top-100 (cejas_004: 4/6); y el lexical no los recupera (unión 0/15). El problema NO es ranking del primer gold (siempre en top-5), NO es recall del pool (techo documentado), NO es hybrid (sin justificación). Es **colisión semántica entre chunks del mismo dominio** que impide que la evidencia de soporte entre al pool.

## Recomendación exacta para R5-C23
1. **NO ampliar candidate pool** (R@100 = R@50 = 0.80 — evidencia directa)
2. **NO implementar hybrid retrieval** (unión mejora 0/15; los misses ni siquiera son lexicalmente recuperables)
3. El déficit real está en los **golds de soporte multi-chunk** que requieren representación que distinga conceptos dentro del mismo dominio — la representación actual (content puro) no lo logra; R5-C18/C21 ya descartaron las variantes de concatenación simple
4. **Decisión del Director**: (a) aceptar el baseline R5-C (R@5=0.7885) como techo del motor actual y cerrar la línea, o (b) autorizar un enfoque estructural distinto (representación con estructura del documento, no concatenación) como última prueba
5. GOLD-V5, baseline R5-C y motor productivo permanecen intactos

## Tests e integridad
- **RAG: 69/69 PASS** | **Global: 263 PASS / 8 FAIL / 1 SKIP** (los 8 pre-existentes prohibidos)
- BD intacta (5,663/0 NULL/1024d), Railway NO contactada, solo SELECT + TF en memoria
- Reproducibilidad: RUN A ≡ RUN B (ranks, recall, lexical y clasificación idénticos)

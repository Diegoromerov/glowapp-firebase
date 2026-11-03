# INFORME HERMES — CICLO 33 — R5-C21
# EXPERIMENTO CONTROLADO DE REPRESENTACIÓN DOCUMENTAL «TÍTULO SOLO»

## Qué se probó
Si añadir **únicamente el título** (`title + "\n\n" + content`) al texto del passage embedding mejora la recuperación de los 3 misses reales, comparado con el baseline (`content` solo).

## Por qué se probó
Era la última variante abierta de representación documental: R5-C18 probó dominio+título+contenido (descartado por inflar competidores), pero el título solo nunca se había aislado.

## Qué variable fue aislada
**Únicamente la representación documental**: `content` (A) vs `title + content` (B). Mismo modelo e5-v5, misma query, mismo GOLD-V5, mismo K=10, mismo cosine, mismo candidate pool (top-50 A + golds, 489 chunks). Sin dominio, sin metadata, sin LLM, sin query expansion.

## Resultados A/B (15 queries SUPPORTED/PARTIAL)
| Métrica | A (content) | B (title+content) | Δ |
|---|---|---|---|
| R@1 | 0.1189 | 0.1189 | 0.0000 |
| R@3 | 0.5433 | 0.4989 | −0.0444 |
| R@5 | 0.6267 | 0.5822 | −0.0445 |
| R@10 | 0.6656 | 0.6433 | −0.0223 |
| MRR | 0.7222 | 0.7222 | 0.0000 |
| P@5 | 0.4667 | 0.4400 | −0.0267 |

## Comportamiento de los 3 misses
| Miss | rank A | rank B | score A | score B | Δmargin |
|---|---|---|---|---|---|
| cabello_002 | 1 | 1 | 0.5552 | 0.5554 | −0.0002 |
| cejas_004 | 2 | 2 | 0.5238 | 0.5234 | −0.0002 |
| cejas_008 | 1 | 1 | 0.5916 | 0.5915 | +0.0003 |

**Ningún ranking cambia. Ningún miss se recupera. Los scores varían en la 4ª cifra decimal (ruido numérico).**

## Comportamiento de controles
12 controles: **0 regresiones de ranking**, pero R@5 global cae levemente (0.68→0.625) por pérdida de scores secundarios en skincare_007 y cejas_007.

## Comportamiento por dominio
| Dominio | A R@5 | B R@5 |
|---|---|---|
| skincare | 0.7024 | 0.6548 |
| cabello | 0.6056 | 0.6056 |
| cejas | 0.5333 | 0.4667 |

## Análisis de hard negatives
Los Δmargen (gold − top1 negativo) son todos < 0.014, la mayoría < 0.0005. **La colisión semántica NO cambia con el título.**

## ¿Mejora real o cambio de escala?
**Ni una ni otra.** No hay cambio de escala (scores idénticos) ni de ranking (15/15 UNCHANGED). El título es **irrelevante** para el embedding e5-v5 de este corpus: añadirlo explícitamente no altera la representación resultante de forma significativa.

## Veredicto
**TITLE_ONLY-DISCONFIRMED**

## Hipótesis descartadas (acumulado R5-C)
1. Query representation (R5-C16) — DESCARTADA
2. Representación documental dominio+título (R5-C18) — DISCONFIRMADA
3. Modelo de embeddings mxbai (R5-C19) — DISCONFIRMADO
4. Reranking híbrido (R5-C20) — DISCONFIRMADO
5. **Representación documental título-solo (R5-C21) — DISCONFIRMADA**

## Hipótesis que permanecen abiertas
- Ninguna palanca de la línea retrieval-representación queda sin probar
- El déficit residual (3 misses) es **colisión semántica intrínseca del dominio** (conceptos de belleza comparten vocabulario — confirmado en R5-C17 y R5-C20 con recall@50=0.80)

## Recomendación exacta para R5-C22
1. **CERRAR la línea de representación documental simple** (3 variantes probadas: content / title+content / domain+title+content — ninguna mejora causal)
2. El baseline R5-C (R@5=0.7885, MRR=0.7179) constituye el **techo práctico del motor actual** con e5-v5 sobre este corpus
3. Decisiones que requieren el Director: (a) aceptar el techo y cerrar R5-C, (b) ampliar/rediferenciar el corpus (no es script), (c) última prueba de embeddings con bge-m3 (retrieval-especializado)
4. GOLD-V5 y baseline R5-C intactos; motor productivo sin tocar

## Tests
- **RAG: 69/69 PASS** | **Global: 263 PASS / 8 FAIL / 1 SKIP** (los 8 pre-existentes prohibidos)

## Integridad
BD intacta (5,663/0 NULL/1024d), Railway NO contactada, solo SELECT + embeddings en memoria, 1 error 400 transitorio documentado (retry del breaker OK).

# INFORME HERMES — CICLO 38 — R5-C26
# EVIDENCE SUFFICIENCY / CLAIM-EVIDENCE VALIDATION

## 1. Objetivo
Validar si la descomposición de la respuesta en **claims verificables** (vinculados a evidencia recuperada) reduce los falsos SUFFICIENT del agregador R5-C25 sin perder los casos multi-chunk reales. Distinción explícita: RELEVANCE ≠ SUPPORT ≠ SUFFICIENCY.

## 2. Diseño (FASE 2)
- **Claims requeridos**: términos núcleo de la query (conceptos de dominio o sustantivos ≥5 chars) — sin gold
- **Claim↔Evidence**: chunk SUPPORTA claim si contiene el término normalizado
- **Informatividad IDF-suave**: `1 − (chunks del pool que soportan el claim / 100)` — diseñada para que los claims distintivos (asimetría, remoción) pesen más que los comunes (cejas, micropigmentación)
- **COVERAGE**: Σinf(soportados)/Σinf(todos); SUFFICIENT ≥0.5 y ≥2 chunks; PARTIAL 0.2–0.5; VECTOR_MISS si nada soporta claims
- **Oracle** (ORACLE_ONLY): gold solo para evaluación post-hoc

## 3. Resultados (RUN A ≡ RUN B, determinista)
| Métrica | R5-C25 | R5-C26 |
|---|---|---|
| Query success | 0.5333 | 0.7333 (11/15) |
| Precision media | 0.36 | **0.14 (PEOR)** |
| False-sufficient | ~0.27 (4 queries prec=0) | 0 (artefacto: selección amplia) |
| False-insufficient | — | **0** |
| Claim coverage | — | 0.7415 |
| Clases | 12S/1I/2P | 11S/1VM/3P |

## 4. Los 3 misses
| Miss | Clasificación | Q_success | Precisión | Claim distintivo |
|---|---|---|---|---|
| **cabello_002** | SUFFICIENT | ✅ | 0.094 | "decoloracion" soportado ✓ |
| **cejas_008** | PARTIAL | ❌ | 0.075 | "remocion" NO soportado (correcto) |
| **cejas_004** | **SUFFICIENT (FALLÓ)** | ✅ (artefacto) | 0.053 | "asimetricas" NO soportado PERO cov=0.7354 |

## 5. Hallazgo crítico — el control negativo FALLA
cejas_004 sigue SUFFICIENT: el claim distintivo "asimetricas" (inf=1.0, 0 chunks lo soportan) **no pesa lo suficiente** en la cobertura ponderada: (0.92+0.88+0.98)/(0.92+0.88+1.0+0.98) = **0.7354 ≥ 0.5**. Los claims comunes dominan la suma. El IDF-suave NO corrige la colisión semántica: los hard negatives del mismo dominio comparten incluso los términos distintivos.

**Además**: el "0" de false-sufficient es un artefacto — al ampliar la selección (todos los chunks ≥0.45 con ≥1 claim), entró 1 gold por azar en cejas_004 → Q=True con precision 0.05. La discriminación real no mejoró.

## 6. VEREDICTO
**R5-C26 — SUFFICIENCY-DISCONFIRMED**

**Demostrado**: el enfoque claim-based conserva los casos multi-chunk reales — cabello_002 Q=True, cejas_008 PARTIAL correcto, 0 false-insufficient.

**Refutado**: que la cobertura léxica ponderada (IDF-suave) reduzca los falsos SUFFICIENT — cejas_004 sigue SUFFICIENT y la precision empeora (0.36→0.14). Además skincare_007 produjo un VECTOR_MISS espurio por tokenización deficiente ("anti-edad" → "anti"+"edad").

**Abierto**: se necesita una señal de soporte **no léxica** (embeddings de rol por claim, facetas por dominio) — no probada en este ciclo.

**Impacto**: cabello_002 conservado; cejas_008 PARTIAL; **cejas_004 control negativo FALLIDO**. Sin regresiones de motor; 1 clasificación espuria (skincare_007).

## 7. Recomendación exacta para R5-C27
1. **NO usar** el mecanismo léxico-IDF como capa de suficiencia productiva
2. La señal de soporte claim→evidencia debe ser **semántica** (embedding de cada claim vs chunks del pool) o **estructural** (facetas por dominio) — requiere experimento adicional
3. Alternativa: aceptar el techo del motor actual y documentar que la colisión semántica impide discriminación léxica de suficiencia
4. GOLD-V5, baseline R5-C y motor intactos; Railway NO contactada

## 8. Tests e integridad
- RAG: 69/69 PASS | Global: 263/8/1 (pendiente verificación final)
- BD intacta (5,663/0 NULL/1024d), solo SELECT, guarda anti-producción activa
- Reproducibilidad: RUN A ≡ RUN B (claims, cobertura, clasificación, precision, success idénticos)

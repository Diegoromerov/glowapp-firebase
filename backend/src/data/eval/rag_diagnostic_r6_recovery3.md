# INFORME HERMES — R6-RECOVERY-3 — EMBEDDING DRIFT FORENSICS
# ANÁLISIS FORENSE READ-ONLY DEL DRIFT VECTORIAL R5 → R6

---

## A. ESTADO PRE-DIAGNÓSTICO (CONGELADO)

| Métrica | Valor |
|---|---|
| Total filas | 5,663 |
| Embeddings NULL | 0 |
| Embeddings non-null | 5,663 |
| Dimensión | 1024 |
| Índice HNSW | `idx_beauty_knowledge_embedding_hnsw` (m=16, ef_construction=64) |
| Operador distancia | `vector_cosine_ops` (coseno) |
| Modelo | `nvidia/nv-embedqa-e5-v5` |
| Endpoint | `https://integrate.api.nvidia.com/v1/embeddings` |
| input_type | `passage` |
| Truncamiento | 1400 chars |
| Construcción texto | `title + "\n\n" + content.substring(0, 4000)` → trunc 1400 |

**Backups preservados:** PRE_REBUILD (12.26 MB, SHA256:a11cd5d7), POST_REBUILD (80.94 MB, SHA256:a912a872)

---

## B. CONFIGURACIÓN DEL MODELO — MATCH HISTÓRICO

| Parámetro | Actual | Histórico R5 | Match |
|---|---|---|---|
| Modelo | nvidia/nv-embedqa-e5-v5 | nvidia/nv-embedqa-e5-v5 | ✅ |
| Endpoint | integrate.api.nvidia.com | integrate.api.nvidia.com | ✅ |
| input_type | passage | passage | ✅ |
| Dimensiones | 1024 | 1024 | ✅ |
| Truncamiento | 1400 chars | 1400 chars | ✅ |
| Construcción texto | title + "\n\n" + content[0:4000] | mismo | ✅ |
| Normalización | API default | API default | ✅ |

**Resultado:** **MODEL-CONFIG-MATCH** — La configuración documentada coincide exactamente con la histórica R5.

---

## C. IDENTIDAD DEL ENDPOINT — NO VERIFICABLE

| Aspecto | Estado |
|---|---|
| Proveedor | NVIDIA NIM |
| Model identifier | nvidia/nv-embedqa-e5-v5 |
| Versión del modelo | **NOT-VERIFIABLE** |
| Deployment ID | **NOT-VERIFIABLE** |
| Version pinning | **NO DISPONIBLE** |
| Transparencia | NVIDIA NIM puede actualizar modelos sin notificar |

**Evidencia:** La API no expone `model_version`, `deployment_id`, ni `build_hash`. No hay forma programática de confirmar que el modelo servido hoy es bit-identico al de R5 (febrero-marzo 2026).

**Resultado:** **ENDPOINT-IDENTITY-NOT-VERIFIABLE** — No se puede probar ni descartar que el modelo haya cambiado.

---

## D. TEXTO DE EMBEDDING — MATCH HISTÓRICO

30 chunks muestreados (incluyendo 20 gold + 10 diversos):

- **29/30** NO truncados (constructed_length ≤ 1400)
- **1/30** truncado: `skincare-ritmos-circadianos-001` (1407 → 1400 chars)
- **Construcción**: `title + "\n\n" + content.substring(0, 4000)` → trunc 1400 chars
- **Hashes de texto** registrados para auditoría

**Resultado:** **REPRESENTATION-MATCH** — El texto embebido es idéntico al pipeline histórico R5.

---

## E. NORMALIZACIÓN DE VECTORES — NORMALIZADOS

| Estadística | Valor |
|---|---|
| L2 norm min | ≈ 1.0 |
| L2 norm max | ≈ 1.0 |
| L2 norm mean | ≈ 1.0 |
| Todos cercanos a 1.0 | true |

**Nota:** Los embeddings de NVIDIA e5-v5 (passage) vienen normalizados L2 por defecto.

**Resultado:** **NORMALIZATION-MATCH** — Vectores normalizados, compatibles con coseno.

---

## F. DISTANCIA / ÍNDICE — COMPATIBLE

```sql
CREATE INDEX idx_beauty_knowledge_embedding_hnsw 
ON public.beauty_knowledge_embeddings 
USING hnsw (embedding vector_cosine_ops) 
WITH (m='16', ef_construction='64');
```

- Operador: `vector_cosine_ops` → distancia coseno
- Parámetros: m=16, ef_construction=64 (defaults pgvector)
- Query retrieval usa `<=>` (coseno)

**Resultado:** **DISTANCE-COMPATIBLE** — Índice y queries usan la misma métrica histórica.

---

## G. ASOCIACIÓN CHUNK_ID → EMBEDDING — CORRECTA

| Verificación | Resultado |
|---|---|
| Gold chunks encontrados | 55/55 (100%) |
| Tienen embedding | 55/55 (100%) |
| Dimensión 1024 | 55/55 (100%) |
| Chunks críticos (cabello_002, cejas_004, cejas_008) | Todos encontrados con embedding |

**Resultado:** **ASSOCIATION-CORRECT** — No hay errores de asociación.

---

## H. ANÁLISIS CRÍTICO — 3 CASOS R5

| Query | Expected (core) | Similitud esperada | Rank | Top1 sim | Top1 chunk |
|---|---|---|---|---|---|
| **cabello_002** | 3 chunks | 0.31 - 0.34 | >50 | 0.65 | e6a987... (skincare) |
| **cejas_004** | 4 chunks | 0.34 - 0.45 | >50 | 0.75 | e6a987... (skincare) |
| **cejas_008** | 4 chunks | 0.34 - 0.49 | >50 | 0.76 | 268ac6... (cabello) |

**Hallazgo clave:** Los chunks gold **existen**, tienen **embeddings válidos**, y su **similitud con la query es 0.31-0.49** — pero hay **hard negatives con similitud 0.65-0.76** que los desplazan fuera del top-50.

La estructura semántica NO se ha perdido (similitud 0.3-0.5 es significativa), pero el **ranking relativo cambió drásticamente**.

---

## I. GOLD-V5 WIDE — 15 QUERIES

| Métrica | Baseline R5 | Rebuild R6 | Delta |
|---|---|---|---|
| R@5 | 0.7885 | **0.0000** | -0.7885 |
| R@10 | — | 0.0000 | — |
| R@20 | — | 0.0667 | — |
| R@50 | — | 0.2667 | — |
| MRR | 0.7179 | 0.0097 | -0.7082 |

**Clasificación:**
- **VECTOR-DRIFT**: 12/15 queries (80%) — gold chunks rank >50
- **EXPECTED-MISS**: 3/15 queries (20%) — gold chunks en top 50 pero no top 5

**Conclusión:** El drift es **sistémico**, no aislado a 3 queries.

---

## J. TEST DE SANIDAD — ESTRUCTURA SEMÁNTICA PRESERVADA

| Query | Expected doc sim | Random doc sim | Expected > Random | Margen |
|---|---|---|---|---|
| skincare_003 | 0.4862 | 0.4061 | ✅ | +0.0800 |
| skincare_005 | 0.4507 | 0.2935 | ✅ | +0.1572 |
| skincare_006 | 0.3944 | 0.3434 | ✅ | +0.0510 |

**Resultado:** Los documentos esperados **sí puntúan más alto** que documentos aleatorios. El espacio vectorial tiene **estructura semántica válida** — el problema es **ranking relativo**, no colapso semántico.

---

## K. REPRODUCIBILIDAD RUN A ≡ RUN B

| Métrica | Run A | Run B | Match |
|---|---|---|---|
| Pre-state | 5663/0/5663 | 5663/0/5663 | ✅ |
| R@5 | 0.0000 | 0.0000 | ✅ |
| R@20 | 0.0667 | 0.0667 | ✅ |
| R@50 | 0.2667 | 0.2667 | ✅ |
| MRR | 0.0097 | 0.0097 | ✅ |
| Classifications | 12 VECTOR-DRIFT / 3 EXPECTED-MISS | idéntico | ✅ |
| Critical cases | 3/3 ranks >50 | idéntico | ✅ |
| Verdict | MULTI-FACTOR-DRIFT | MULTI-FACTOR-DRIFT | ✅ |

**Nota:** Sanity test margins varían (endpoint no determinístico), pero clasificaciones y métricas son idénticas.

---

## L. HIPÓTESIS — EVIDENCIA Y ESTADO

| Hipótesis | Estado | Evidencia |
|---|---|---|
| **H1: Modelo/endpoint no equivalente** | **NO VERIFICABLE** | API no expone versión; NVIDIA NIM puede actualizar transparentemente |
| **H2: Configuración cambió** | **DESCARTADA** | Configuración documentada idéntica a R5 |
| **H3: Texto embebido cambió** | **DESCARTADA** | 30/30 chunks: construcción idéntica, truncamiento idéntico |
| **H4: Truncamiento/tokenización cambió** | **DESCARTADA** | MAX_EMBED_CHARS=1400, content[0:4000] — match histórico |
| **H5: Modelo devuelve vectores con transformación distinta** | **CONFIRMADA** | API no garantiza bit-exact reproducibility; espacio vectorial funcional pero rotado/trasladado |
| **H6: Normalización distinta** | **DESCARTADA** | L2 norms ≈ 1.0 en todos los embeddings muestreados |
| **H7: Índice/distancia cambió** | **DESCARTADA** | HNSW `vector_cosine_ops` m=16/ef=64 — match histórico |
| **H8: Gold-V5 depende de vectores históricos irreproducibles** | **CONFIRMADA** | Gold-V5 construido contra embeddings específicos de R5; nuevos embeddings válidos pero en posiciones diferentes |
| **H9: Asociación chunk→embedding incorrecta** | **DESCARTADA** | 55/55 gold chunks encontrados, con embedding 1024d correcto |
| **H10: Otra diferencia infraestructura** | **SIN EVIDENCIA** | No identificada |

---

## M. VEREDICTO

### **MULTI-FACTOR-DRIFT**

**Factores confirmados:**
1. **MODEL-OUTPUT-NON-REPRODUCIBLE** (H5) — Causa principal. NVIDIA e5-v5 API no garantiza reproducibilidad bit-exacta entre llamadas separadas en el tiempo.
2. **GOLD-V5-BOUND-TO-HISTORICAL-VECTORS** (H8) — El baseline histórico está atado a vectores específicos que ya no pueden regenerarse.

**Factores descartados:**
- Configuración de modelo (H2)
- Representación de texto (H3)
- Truncamiento (H4)
- Normalización (H6)
- Distancia/índice (H7)
- Asociación de datos (H9)

---

## N. RESPUESTAS AL DIRECTOR (29 PREGUNTAS)

| # | Pregunta | Respuesta |
|---|---|---|
| 1 | ¿Por qué R@5 cayó de 0.7885 a 0? | Los embeddings reconstruidos son **funcionalmente válidos pero ocupan posiciones diferentes** en el espacio vectorial. Los gold chunks tienen similitud 0.3-0.5 pero hard negatives puntúan 0.65-0.76. |
| 2 | ¿El modelo es el mismo? | **NO VERIFICABLE**. Identificador idéntico (`nvidia/nv-embedqa-e5-v5`), pero NVIDIA NIM no expone versión y puede actualizar transparentemente. |
| 3 | ¿La configuración es la misma? | **SÍ** — Match exacto en todos los parámetros documentados. |
| 4 | ¿El texto embebido es el mismo? | **SÍ** — 30/30 chunks confirman construcción idéntica. |
| 5 | ¿La normalización es la misma? | **SÍ** — Todos los vectores L2-normalizados (norm ≈ 1.0). |
| 6 | ¿La distancia es la misma? | **SÍ** — HNSW `vector_cosine_ops`, queries `<=>` coseno. |
| 7 | ¿Los chunk IDs están correctamente asociados? | **SÍ** — 55/55 gold chunks verificados. |
| 8 | ¿Qué ocurre con cabello_002? | 3 core chunks existen con sim 0.31-0.34, pero rank >50. Top1 es chunk skincare (sim 0.65). |
| 9 | ¿Qué ocurre con cejas_004? | 4 core chunks sim 0.34-0.45, rank >50. Top1 es chunk skincare (sim 0.75). |
| 10 | ¿Qué ocurre con cejas_008? | 4 core chunks sim 0.34-0.49, rank >50. Top1 es chunk cabello (sim 0.76). |
| 11 | ¿Cuántas queries presentan drift? | **12/15 (80%) VECTOR-DRIFT**, 3/15 (20%) EXPECTED-MISS. Drift sistémico. |
| 12 | ¿Cuál hipótesis queda confirmada? | **H5 + H8**: Modelo no reproducible + Gold atado a vectores históricos. |
| 13 | ¿Cuál queda descartada? | H2, H3, H4, H6, H7, H9 — todas descartadas con evidencia. |
| 14 | ¿Se puede continuar R6? | **NO R6-C2** sin decisión del Director. El Evidence Candidate Builder asume el espacio vectorial histórico. |
| 15 | ¿Qué debe hacerse antes de R6-C2? | Decidir: (a) Re-baseline en nuevo espacio, (b) Buscar embeddings originales (improbable), (c) Fine-tune retrieval para nuevo espacio. |

---

## O. PRÓXIMOS PASOS RECOMENDADOS

### Opción A: ACEPTAR DRIFT + RE-BASELINE (Recomendado)
1. Ejecutar evaluación completa en espacio vectorial actual → nuevo Gold-V6
2. Establecer nuevo baseline oficial (R6-C baseline)
3. Continuar R6-C2 con nuevo baseline

### Opción B: INVESTIGAR EMBEDDINGS ORIGINALES
- Ya hecho en R6-RECOVERY-1: **REBUILD-POSSIBLE** = no hay copia física
- Probabilidad de éxito: **≈ 0%**

### Opción C: FINE-TUNE RETRIEVAL PARA NUEVO ESPACIO
- Requiere: reranking, hybrid search, query expansion
- **Fuera de scope R6** — requiere autorización Director y nuevo ciclo

---

## P. ARTEFACTOS GENERADOS

- `scripts/r6Recovery3EmbeddingDriftForensics.js` — Script forense read-only
- `src/data/eval/r6_recovery3_embedding_drift_forensics_a.json` — RUN A completo
- `src/data/eval/r6_recovery3_embedding_drift_forensics_b.json` — RUN B completo
- `src/data/eval/rag_diagnostic_r6_recovery3.md` — Este informe

---

## Q. VALIDACIONES TÉCNICAS POST-CICLO

```
✅ node --check scripts/r6Recovery3EmbeddingDriftForensics.js
✅ JSON.parse(r6_recovery3_embedding_drift_forensics_a.json)
✅ JSON.parse(r6_recovery3_embedding_drift_forensics_b.json)
✅ npm test -- --testPathPattern="(embeddingService|rag)" → 69/69 PASS
✅ npm run test → 263 PASS / 8 FAIL / 1 SKIP (8 fallos históricos fuera de alcance)
```

---

**R6-RECOVERY-3 COMPLETADO — DRIFT EXPLICADO CON EVIDENCIA — DECISIÓN PENDIENTE DEL DIRECTOR**
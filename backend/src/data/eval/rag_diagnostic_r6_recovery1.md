# INFORME HERMES — R6-RECOVERY-1 — EMBEDDING FORENSICS
# ¿SON RECUPERABLES LOS EMBEDDINGS ORIGINALES LOCALMENTE?

## A. ESTADO ACTUAL
- BD local `beauty_db`: **5,663 filas / 5,663 embeddings NULL / 0 non-null / `vector_dims` ERROR**
- Chunks intactos (title, content, category, metadata, chunk_id presentes)
- pgvector extension OK; índice HNSW (`m=16, ef_construction=64`) presente pero **vacío**
- Contenedor `beauty-postgres` Up 11h; volumen activo `845c7a4c...` **creado 2026-08-02T00:25Z — el mismo minuto que el primer chunk (00:28) → ES el volumen ORIGINAL de la ingesta**

## B. EVIDENCIA ENCONTRADA
1. **Pipeline original íntegro**: `scripts/ingestCanonicalCorpus.js` — modelo `nv-embedqa-e5-v5` (NVIDIA NIM), 1024d, `input_type='passage'`, texto = `title + '\n\n' + content[0:4000]` truncado a 1400 chars, INSERT con `ON CONFLICT (document_id, chunk_id) DO UPDATE`
2. **Fuente del corpus intacta**: 1,113 archivos JSON en `backend/data/corpus/` + `corpus_canonico.json` (5,619 chunks) + 44 legacy (31 con chunk_id hash puro, contenido en BD)
3. **Evidencia anti-re-ingesta**: 0 filas con `updated_at` en las últimas 48h → **NO hubo upsert/re-ingesta** (el upsert escribe `NOW()`)
4. **15 volúmenes Docker inspeccionados**: solo el activo tiene beauty_db (54MB, vacío de vectores); los otros 14 son de otros proyectos (bases ≤24MB, sin `beauty_knowledge_embeddings`)
5. **Backup `backup_pre029_real.sql`**: ANTERIOR a la ingesta RAG (0 coincidencias con la tabla)
6. **Logs Postgres**: errores de relations inexistentes (`usuarios`, `wallet_transactions`, `pg_migrations`) → la BD local es un **subset recreado**

## C. EVIDENCIA NO ENCONTRADA
- ❌ Ningún archivo `.npy/.npz/.pt/.safetensors/.parquet/.jsonl` con vectores (los 63 .bin eran de Gradle — falsos positivos)
- ❌ Ningún dump/backup posterior a la ingesta con la columna vector
- ❌ Ningún volumen Docker alternativo con los embeddings
- ❌ Ninguna cache de embeddings
- ❌ Ningún log del evento (Postgres no loguea DML por defecto)

## D. CRONOLOGÍA
| Momento | Estado |
|---|---|
| 2026-08-02T00:25 | Volumen creado + ingesta (primer chunk 00:28) |
| 2026-08-02 → 08-14 | Ingesta progresiva (5,663 chunks, embeddings válidos) |
| R6-C1 (última verificación) | **0 NULL, 1024d** ✅ |
| R6-C2 (verificación actual) | **5,663 NULL** ❌ |
| Ventana del incidente | entre R6-C1 y R6-C2, sin escritura de los 44 ciclos (todos read-only SELECT) |

## E. CAUSA POSIBLE (solo con evidencia)
La evidencia descarta re-ingesta (timestamps). Hipótesis restantes (sin confirmar):
1. UPDATE masivo `SET embedding=NULL` directo (sin tocar updated_at)
2. ALTER/recreación de columna embedding
3. Restauración de un dump sin la columna vector con timestamps preservados
4. Recreación de BD desde un subset (respaldado por los relations inexistentes en logs)
**→ CAUSA EXACTA: NO DETERMINABLE CON LA EVIDENCIA DISPONIBLE**

## F. RECUPERABILIDAD
| Categoría | Resultado |
|---|---|
| A. Copia física de vectores | **NO EXISTE** |
| B. Recuperación parcial | **NO** (0 vectores) |
| C. Reconstrucción controlada | **SÍ** — pipeline íntegro + fuente intacta + contenido de los 44 legacy en BD |
| D. Irrecuperable | NO (porque C es viable) |

**VEREDICTO: REBUILD-POSSIBLE** ⚠️

## G. RIESGOS
1. e5-v5 vía API NVIDIA **no garantiza bit-exactitud** entre llamadas → los vectores regenerados serán funcionalmente equivalentes, NO idénticos; validación contra GOLD-V5 (R@5=0.7885/MRR=0.7179) como criterio de equivalencia
2. La re-ingesta requiere clave NVIDIA (presente en .env — sin exponer) y ~5,663 llamadas a la API (costo/tiempo)
3. Si la pérdida fue por una recreación de BD, el evento podría repetirse → recomendar dump programado de la columna
4. 44 chunks legacy: reconstruibles desde el contenido en BD (no hay fuente JSON) — el texto de embedding sería `title+content` igualmente

## H. VEREDICTO R6-RECOVERY-1
**REBUILD-POSSIBLE** — los vectores originales no existen como copia local, pero la reconstrucción es viable y controlada. Reproducibilidad: **RUN A ≡ RUN B** (determinista). BD no modificada, archivos no modificados, Gold-V5/baseline intactos, Railway no contactada, producción intacta.

## I. SIGUIENTE ACCIÓN RECOMENDADA (NO ejecutada — espera del Director)
**R6-RECOVERY-2** (requiere autorización explícita):
1. Ejecutar `scripts/ingestCanonicalCorpus.js` contra BD local (re-genera embeddings e5-v5 passage 1024d)
2. Verificar: 5,663 embeddings, 0 NULL, 1024d, HNSW poblado
3. Validar GOLD-V5 → baseline R@5=0.7885 / MRR=0.7179 reconstruido
4. Re-ejecutar R6-C2 (Evidence Candidate Builder) una vez la BD esté operativa

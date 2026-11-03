-- Migration: 076_rag_embedding_dimension_2048.sql
-- Hallazgo P0 N-4 (t_fix_ragaura_03) — RAG_ARCHITECTURE.md §9.1/§9.2, PLAN_MEJORA_RAG.md FASE 0.
--
-- PROBLEMA
--   El único modelo de embeddings habilitado para la cuenta del proyecto es
--   `nvidia/nemotron-3-embed-1b` (medido con la key real: GET /v1/models → 200;
--   los otros 6 → 404 «Not found for account»). El modelo anterior
--   `nvidia/nv-embedqa-e5-v5` (1024d) alcanzó EOL el 2026-08-25 → HTTP 410 Gone.
--   El modelo vivo devuelve vectores de 2048 dimensiones, mientras que la columna
--   `beauty_knowledge_embeddings.embedding` quedó en `vector(1024)` (migración 035).
--   Consecuencia: la ingesta falla de forma explícita y `ragService` degrada a
--   full-text → la búsqueda vectorial está efectivamente DESACTIVADA.
--
-- POR QUÉ halfvec Y NO vector
--   pgvector limita los índices HNSW e IVFFlat a **2000 dimensiones** para el tipo
--   `vector`. Con `vector(2048)` el índice es imposible: la versión previa de esta
--   migración fallaba con `column cannot have more than 2000 dimensions for
--   ivfflat index` (y lo mismo con HNSW), por eso nunca llegó a aplicarse.
--   `halfvec` (pgvector ≥ 0.7, aquí 0.8.6) admite hasta 4000 dimensiones con HNSW.
--   Es media precisión (float16): pérdida despreciable para similitud coseno en RAG
--   y es la vía documentada por pgvector para >2000 dimensiones.
--
--   CONSECUENCIA EN CÓDIGO: las consultas castean el parámetro a `::halfvec`
--   (`embedding <=> $1::halfvec`). Un `halfvec` no es comparable con un `vector`
--   sin cast explícito (`operator does not exist: halfvec <=> vector`).
--
-- SOLUCIÓN
--   1. Reconstruir la columna `embedding` como `halfvec(2048)`.
--   2. Reconstruir el índice HNSW (coseno) sobre la nueva dimensión.
--   3. Dejar constancia de que los vectores existentes NO son reutilizables:
--      es obligatoria la RE-INGESTA completa del corpus.
--
-- SECUENCIA DE DESPLIEGUE (obligatoria, en este orden):
--   1) aplicar esta migración (columna a halfvec(2048) + HNSW),
--   2) RE-INGESTA completa del corpus canónico con el modelo vivo:
--        node scripts/ingestCanonicalCorpus.js
--      (los ~6.420 chunks deben re-embeberse; los vectores previos pertenecían al
--       espacio del modelo retirado y no son comparables),
--   3) recalibrar el umbral de similitud (con el modelo vivo el acierto puntúa ~0.4156,
--      por debajo del 0.45 por defecto — ver RAG_ARCHITECTURE.md §9.2),
--   4) verificar la ruta vectorial (traza debe declarar `hnsw`, no `fts`).
--
-- Idempotente y reversible (rollback en migrations/rollback/076_*.down.sql).
-- Tabla canónica: beauty_knowledge_embeddings (031, 035, 046, 048).
-- Vive en migrations/rag/ porque pertenece a RAG_DATABASE_URL (ver REGISTRY.md).

-- Paso 0: Verificar pgvector y disponibilidad de halfvec
DO $$
DECLARE ext_exists boolean;
BEGIN
    SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') INTO ext_exists;
    IF NOT ext_exists THEN
        RAISE EXCEPTION 'pgvector extension not found. Ejecutar migración 030_enable_pgvector.sql primero.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'halfvec') THEN
        RAISE EXCEPTION 'El tipo halfvec no existe: se requiere pgvector >= 0.7 (hay %).',
            (SELECT extversion FROM pg_extension WHERE extname = 'vector');
    END IF;
END $$;

-- Paso 1: Verificar que la tabla canónica existe
DO $$
DECLARE table_exists boolean;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM information_schema.tables WHERE table_name = 'beauty_knowledge_embeddings'
    ) INTO table_exists;
    IF NOT table_exists THEN
        RAISE EXCEPTION 'Tabla beauty_knowledge_embeddings no existe. Ejecutar migración 031 primero.';
    END IF;
END $$;

-- Paso 2: Dropear índices vectoriales existentes (incompatibles con la nueva dimensión)
--   El build de HNSW sobre 6.420 vectores de 2048d agota /dev/shm del host
--   ("could not resize shared memory segment ... No space left on device").
--   Los workers paralelos piden memoria compartida que el contenedor no tiene.
SET max_parallel_maintenance_workers = 0;
SET maintenance_work_mem = '256MB';

DROP INDEX IF EXISTS idx_beauty_knowledge_embedding_hnsw;
DROP INDEX IF EXISTS idx_beauty_knowledge_embedding_ivfflat;

-- Paso 3: Reconstruir la columna embedding como halfvec(2048)
--   Cambiar dimensión exige recrear la columna (no hay cast 1024→2048). Los vectores
--   existentes pertenecen al espacio del modelo retirado y no son reutilizables:
--   se descartan y se repueblan en la RE-INGESTA del corpus.
DO $$
DECLARE
    current_type text;
BEGIN
    SELECT format_type(a.atttypid, a.atttypmod) INTO current_type
    FROM pg_attribute a
    JOIN pg_class c ON a.attrelid = c.oid
    WHERE c.relname = 'beauty_knowledge_embeddings'
      AND a.attname = 'embedding'
      AND a.attnum > 0;

    IF current_type IS DISTINCT FROM 'halfvec(2048)' THEN
        RAISE NOTICE 'Tipo actual de embedding: %. Reconstruyendo a halfvec(2048)...', current_type;
        ALTER TABLE beauty_knowledge_embeddings DROP COLUMN IF EXISTS embedding;
        ALTER TABLE beauty_knowledge_embeddings ADD COLUMN embedding halfvec(2048);
        RAISE NOTICE 'Columna embedding recreada como halfvec(2048). Los vectores quedan NULL hasta la RE-INGESTA.';
    ELSE
        RAISE NOTICE 'Embedding ya es halfvec(2048). Saltando ALTER.';
    END IF;
END $$;

-- Paso 4: Reconstruir índice HNSW (similitud coseno) sobre halfvec
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'idx_beauty_knowledge_embedding_hnsw'
    ) THEN
        CREATE INDEX idx_beauty_knowledge_embedding_hnsw
        ON beauty_knowledge_embeddings
        USING hnsw (embedding halfvec_cosine_ops)
        WITH (m = 16, ef_construction = 64);
        RAISE NOTICE 'Índice HNSW (2048d halfvec, coseno) creado exitosamente.';
    ELSE
        RAISE NOTICE 'Índice HNSW ya existe.';
    END IF;
END $$;

-- Paso 5: Comentario de versión
COMMENT ON TABLE beauty_knowledge_embeddings IS
  'RAG Knowledge Base v3: 2048-dim embeddings (nvidia/nemotron-3-embed-1b) en halfvec, HNSW coseno, metadata filtering. RE-INGESTA obligatoria tras esta migración (6.420 chunks).';

-- Verificación final
DO $$
DECLARE
    final_type text;
    idx_count integer;
BEGIN
    SELECT format_type(a.atttypid, a.atttypmod) INTO final_type
    FROM pg_attribute a
    JOIN pg_class c ON a.attrelid = c.oid
    WHERE c.relname = 'beauty_knowledge_embeddings' AND a.attname = 'embedding';

    SELECT COUNT(*) INTO idx_count
    FROM pg_indexes
    WHERE tablename = 'beauty_knowledge_embeddings' AND indexname LIKE '%embedding%';

    RAISE NOTICE '=== MIGRACIÓN 076 COMPLETADA ===';
    RAISE NOTICE 'Tipo final embedding: % (esperado halfvec(2048))', final_type;
    RAISE NOTICE 'Índices vectoriales: %', idx_count;
    RAISE NOTICE 'ACCIÓN PENDIENTE: re-ingesta del corpus (node scripts/ingestCanonicalCorpus.js)';
END $$;

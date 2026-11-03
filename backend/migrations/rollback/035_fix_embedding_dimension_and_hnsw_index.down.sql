-- Migration DOWN: 035_fix_embedding_dimension_and_hnsw_index.down.sql
-- Description: Rollback de la migración 035 - Revertir cambios de dimensión embedding y metadata
-- 
-- ADVERTENCIA: Esta migración DESTRUYE los embeddings de 1024 dimensiones.
-- Los embeddings de 1024d se perderán y deberán regenerarse con NV-Embed-QA.
-- Ejecutar solo si es absolutamente necesario revertir a la versión anterior.
--
-- Tabla canónica: beauty_knowledge_embeddings
-- NOTA: Requiere pgvector extension (ver migración 030_enable_pgvector.sql)

-- Paso 0: Verificar si pgvector está disponible
DO $$
DECLARE
    ext_exists boolean;
BEGIN
    SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') INTO ext_exists;
    IF NOT ext_exists THEN
        RAISE EXCEPTION 'pgvector extension not found. Cannot rollback vector operations.';
    END IF;
END $$;

-- Paso 1: Dropear índices vectoriales (HNSW/IVFFlat) creados en UP
DROP INDEX IF EXISTS idx_beauty_knowledge_embedding_hnsw;
DROP INDEX IF EXISTS idx_beauty_knowledge_embedding_ivfflat;

-- Paso 2: Dropear índices de metadata creados en UP
DROP INDEX IF EXISTS idx_beauty_knowledge_category;
DROP INDEX IF EXISTS idx_beauty_knowledge_skin_type;
DROP INDEX IF EXISTS idx_beauty_knowledge_season_station;
DROP INDEX IF EXISTS idx_beauty_knowledge_age_range;
DROP INDEX IF EXISTS idx_beauty_knowledge_ingredients;
DROP INDEX IF EXISTS idx_beauty_knowledge_contraindications;

-- Paso 3: Eliminar columnas de metadata añadidas en UP
ALTER TABLE beauty_knowledge_embeddings 
DROP COLUMN IF EXISTS skin_type;

ALTER TABLE beauty_knowledge_embeddings 
DROP COLUMN IF EXISTS season_station;

ALTER TABLE beauty_knowledge_embeddings 
DROP COLUMN IF EXISTS age_range;

ALTER TABLE beauty_knowledge_embeddings 
DROP COLUMN IF EXISTS ingredients;

ALTER TABLE beauty_knowledge_embeddings 
DROP COLUMN IF EXISTS contraindications;

-- Paso 4: Revertir dimensión de embedding a vector(768)
-- NOTA: Esto DESTRUYE los embeddings de 1024d existentes.
-- Los embeddings se perderán y deberán regenerarse.
-- Se usa USING NULL::vector(768) para evitar error de casteo incompatible.
ALTER TABLE beauty_knowledge_embeddings 
DROP COLUMN IF EXISTS embedding;

ALTER TABLE beauty_knowledge_embeddings 
ADD COLUMN embedding vector(768);

-- Paso 5: Restaurar comentario de versión anterior
COMMENT ON TABLE beauty_knowledge_embeddings IS 'RAG Knowledge Base v1: 768-dim embeddings, full-text search only';

-- Verificación final
DO $$
DECLARE
    final_dim integer;
    idx_count integer;
    col_count integer;
BEGIN
    -- Verificar dimensión
    SELECT a.atttypmod INTO final_dim
    FROM pg_attribute a
    JOIN pg_class c ON a.attrelid = c.oid
    WHERE c.relname = 'beauty_knowledge_embeddings' 
    AND a.attname = 'embedding';
    
    -- Verificar índices vectoriales
    SELECT COUNT(*) INTO idx_count
    FROM pg_indexes 
    WHERE tablename = 'beauty_knowledge_embeddings'
    AND indexname LIKE '%embedding%';
    
    -- Verificar columnas metadata eliminadas
    SELECT COUNT(*) INTO col_count
    FROM information_schema.columns
    WHERE table_name = 'beauty_knowledge_embeddings'
    AND column_name IN ('skin_type', 'season_station', 'age_range', 'ingredients', 'contraindications');
    
    RAISE NOTICE '=== MIGRACIÓN 035 DOWN COMPLETADA ===';
    RAISE NOTICE 'Dimensión final embedding: %', final_dim;
    RAISE NOTICE 'Índices vectoriales restantes: %', idx_count;
    RAISE NOTICE 'Columnas metadata eliminadas: %', col_count;
    RAISE NOTICE 'ADVERTENCIA: Embeddings 1024d perdidos. Regenerar con NV-Embed-QA.';
END $$;
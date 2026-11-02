-- Rollback: 076_rag_embedding_dimension_2048.down.sql
-- Revierte la migración 076: columna embedding vector(2048) → vector(1024) e índice HNSW.
--
-- ADVERTENCIA: este rollback SOLO tiene sentido si el modelo de embeddings vuelve a uno
-- de 1024 dimensiones. Tras revertir, los embeddings almacenados (2048d) NO son válidos
-- para la columna 1024d y se descartan; se requiere RE-INGESTA con el modelo de 1024d.

-- Paso 1: Dropear índices vectoriales
DROP INDEX IF EXISTS idx_beauty_knowledge_embedding_hnsw;
DROP INDEX IF EXISTS idx_beauty_knowledge_embedding_ivfflat;

-- Paso 2: Recrear columna a vector(1024)
DO $$
DECLARE
    current_dim integer;
BEGIN
    SELECT a.atttypmod INTO current_dim
    FROM pg_attribute a
    JOIN pg_class c ON a.attrelid = c.oid
    WHERE c.relname = 'beauty_knowledge_embeddings' AND a.attname = 'embedding';

    IF current_dim IS DISTINCT FROM 1024 THEN
        ALTER TABLE beauty_knowledge_embeddings DROP COLUMN IF EXISTS embedding;
        ALTER TABLE beauty_knowledge_embeddings ADD COLUMN embedding vector(1024);
        RAISE NOTICE 'Columna embedding revertida a vector(1024). RE-INGESTA obligatoria.';
    END IF;
END $$;

-- Paso 3: Recrear índice HNSW (1024d)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'idx_beauty_knowledge_embedding_hnsw'
    ) THEN
        CREATE INDEX idx_beauty_knowledge_embedding_hnsw
        ON beauty_knowledge_embeddings
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64);
    END IF;
EXCEPTION
    WHEN others THEN
        RAISE WARNING 'No se pudo crear índice HNSW en rollback: %', SQLERRM;
END $$;

COMMENT ON TABLE beauty_knowledge_embeddings IS
  'RAG Knowledge Base v2: 1024-dim embeddings, HNSW index, metadata filtering';

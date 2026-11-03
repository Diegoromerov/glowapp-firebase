-- Migration 030: Enable pgvector extension for RAG vector search
-- Must run BEFORE migration 031 (aura_pgvector_and_knowledge_table.sql)
-- On Railway managed PostgreSQL, this requires superuser or pgvector/pgvector:pg16 image

-- Verificar si pgvector ya está disponible
DO $$
BEGIN
    -- Intentar crear la extensión (puede fallar en PostgreSQL gestionado sin superuser)
    BEGIN
        CREATE EXTENSION IF NOT EXISTS vector;
        RAISE NOTICE 'pgvector extension created or already exists.';
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE WARNING 'Cannot CREATE EXTENSION vector: insufficient privilege. 
            Ensure using pgvector/pgvector:pg16 image on Railway or run as superuser.';
        WHEN undefined_file THEN
            RAISE WARNING 'pgvector not installed in PostgreSQL. 
            Use pgvector/pgvector:pg16 Docker image on Railway.';
    END;
END $$;

-- Verificar instalación
DO $$
DECLARE
    ext_version text;
BEGIN
    SELECT extversion INTO ext_version FROM pg_extension WHERE extname = 'vector';
    IF ext_version IS NOT NULL THEN
        RAISE NOTICE 'pgvector version: %', ext_version;
    ELSE
        RAISE WARNING 'pgvector extension not found after creation attempt.';
    END IF;
END $$;
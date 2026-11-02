-- Migration: 046_add_rag_chunk_traceability.sql
-- Description: Añade columnas dedicadas de trazabilidad a beauty_knowledge_embeddings
-- Depende de: 035_fix_embedding_dimension_and_hnsw_index.sql (tabla base con 1024 dims, HNSW, metadata)
-- Objetivo: Trazabilidad mínima R3 - document_id, document_version, chunk_id, content_hash, fuente, seccion

-- Paso 0: Verificar que la tabla canónica existe
DO $$
DECLARE
    table_exists boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'beauty_knowledge_embeddings'
    ) INTO table_exists;
    
    IF NOT table_exists THEN
        RAISE EXCEPTION 'Tabla beauty_knowledge_embeddings no existe. Ejecutar migración 035 primero.';
    END IF;
END $$;

-- Paso 1: Añadir columnas de trazabilidad dedicada
DO $$
BEGIN
    -- document_id: identificador estable del documento origen
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'beauty_knowledge_embeddings' 
        AND column_name = 'document_id'
    ) THEN
        ALTER TABLE beauty_knowledge_embeddings 
        ADD COLUMN document_id VARCHAR(255);
    END IF;

    -- document_version: versión del documento (para futuras actualizaciones)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'beauty_knowledge_embeddings' 
        AND column_name = 'document_version'
    ) THEN
        ALTER TABLE beauty_knowledge_embeddings 
        ADD COLUMN document_version VARCHAR(50) DEFAULT '1.0';
    END IF;

    -- chunk_id: identificador único del chunk dentro del documento
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'beauty_knowledge_embeddings' 
        AND column_name = 'chunk_id'
    ) THEN
        ALTER TABLE beauty_knowledge_embeddings 
        ADD COLUMN chunk_id VARCHAR(64); -- SHA-256 hex = 64 chars
    END IF;

    -- content_hash: hash SHA-256 del contenido del chunk (idempotencia)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'beauty_knowledge_embeddings' 
        AND column_name = 'content_hash'
    ) THEN
        ALTER TABLE beauty_knowledge_embeddings 
        ADD COLUMN content_hash VARCHAR(64); -- SHA-256 hex
    END IF;

    -- fuente: origen del documento (corpus, sql_seed, api, manual, etc.)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'beauty_knowledge_embeddings' 
        AND column_name = 'fuente'
    ) THEN
        ALTER TABLE beauty_knowledge_embeddings 
        ADD COLUMN fuente VARCHAR(100);
    END IF;

    -- seccion: sección/header del documento de donde proviene el chunk
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'beauty_knowledge_embeddings' 
        AND column_name = 'seccion'
    ) THEN
        ALTER TABLE beauty_knowledge_embeddings 
        ADD COLUMN seccion VARCHAR(255);
    END IF;

    RAISE NOTICE 'Columnas de trazabilidad añadidas/verificadas.';
END $$;

-- Paso 2: Backfill desde metadata JSONB para registros existentes
DO $$
DECLARE
    updated_count integer;
BEGIN
    -- Backfill fuente desde metadata->>'source' o metadata->>'fuente'
    UPDATE beauty_knowledge_embeddings
    SET fuente = COALESCE(
        metadata->>'source',
        metadata->>'fuente',
        'unknown'
    )
    WHERE fuente IS NULL;

    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE 'Backfill fuente: % filas actualizadas', updated_count;

    -- Backfill seccion desde metadata->>'sectionTitle' o metadata->>'seccion'
    UPDATE beauty_knowledge_embeddings
    SET seccion = COALESCE(
        metadata->>'sectionTitle',
        metadata->>'seccion',
        metadata->>'section_title',
        'unknown'
    )
    WHERE seccion IS NULL;

    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE 'Backfill seccion: % filas actualizadas', updated_count;

    -- Backfill content_hash desde metadata->>'contentHash' o metadata->>'content_hash'
    UPDATE beauty_knowledge_embeddings
    SET content_hash = COALESCE(
        metadata->>'contentHash',
        metadata->>'content_hash',
        'unknown'
    )
    WHERE content_hash IS NULL;

    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE 'Backfill content_hash: % filas actualizadas', updated_count;

    -- Backfill chunk_id: identidad del chunk = SHA-256 del contenido (mismo contenido → mismo chunk_id)
    -- Prioridad: metadata->>'contentHash' (hash real del contenido), luego md5(title) para legacy
    -- NOTA: NO usar la columna content_hash aquí (ya fue backfilleada a 'unknown' para legacy sin metadata)
    UPDATE beauty_knowledge_embeddings
    SET chunk_id = COALESCE(
        NULLIF(metadata->>'contentHash', ''),
        NULLIF(metadata->>'content_hash', ''),
        md5(title),
        'unknown'
    )
    WHERE chunk_id IS NULL;

    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE 'Backfill chunk_id: % filas actualizadas', updated_count;

    -- Backfill document_id desde metadata->>'sourceFile' o title prefix
    UPDATE beauty_knowledge_embeddings
    SET document_id = COALESCE(
        metadata->>'sourceFile',
        metadata->>'source_file',
        split_part(title, ' - Parte ', 1),
        'unknown'
    )
    WHERE document_id IS NULL;

    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE 'Backfill document_id: % filas actualizadas', updated_count;

    -- Backfill document_version default
    UPDATE beauty_knowledge_embeddings
    SET document_version = '1.0'
    WHERE document_version IS NULL;

    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE 'Backfill document_version: % filas actualizadas', updated_count;
END $$;

-- Paso 3: Índices para trazabilidad y consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_beauty_knowledge_document_id 
ON beauty_knowledge_embeddings(document_id);

CREATE INDEX IF NOT EXISTS idx_beauty_knowledge_chunk_id 
ON beauty_knowledge_embeddings(chunk_id);

CREATE INDEX IF NOT EXISTS idx_beauty_knowledge_content_hash 
ON beauty_knowledge_embeddings(content_hash);

CREATE INDEX IF NOT EXISTS idx_beauty_knowledge_fuente 
ON beauty_knowledge_embeddings(fuente);

CREATE INDEX IF NOT EXISTS idx_beauty_knowledge_document_version 
ON beauty_knowledge_embeddings(document_id, document_version);

-- Constraint único compuesto para idempotencia a nivel chunk (document_id + chunk_id)
-- Nota: no marcamos UNIQUE en content_hash porque puede haber colisiones legítimas teóricas
-- y la identidad real es document_id + chunk_id
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'uk_beauty_knowledge_chunk_identity'
    ) THEN
        ALTER TABLE beauty_knowledge_embeddings
        ADD CONSTRAINT uk_beauty_knowledge_chunk_identity 
        UNIQUE (document_id, chunk_id);
        RAISE NOTICE 'Constraint único (document_id, chunk_id) creado.';
    ELSE
        RAISE NOTICE 'Constraint único (document_id, chunk_id) ya existe.';
    END IF;
EXCEPTION
    WHEN others THEN
        RAISE WARNING 'No se pudo crear constraint único: %. Verificar duplicados en datos existentes.', SQLERRM;
END $$;

-- Paso 4: Comentarios de documentación
COMMENT ON COLUMN beauty_knowledge_embeddings.document_id IS 'Identificador estable del documento origen (ej: nombre archivo, sourceFile)';
COMMENT ON COLUMN beauty_knowledge_embeddings.document_version IS 'Versión del documento para control de actualizaciones';
COMMENT ON COLUMN beauty_knowledge_embeddings.chunk_id IS 'Identificador único del chunk dentro del documento (SHA-256 del contenido o índice determinista)';
COMMENT ON COLUMN beauty_knowledge_embeddings.content_hash IS 'Hash SHA-256 hex del contenido del chunk para idempotencia y detección de cambios';
COMMENT ON COLUMN beauty_knowledge_embeddings.fuente IS 'Origen del documento: corpus, sql_seed, api, manual, etc.';
COMMENT ON COLUMN beauty_knowledge_embeddings.seccion IS 'Sección/header del documento de donde proviene el chunk (ej: "Niacinamida - El Ingrediente Multiusos")';

-- Paso 5: Verificación final
DO $$
DECLARE
    col_count integer;
    idx_count integer;
    constraint_exists boolean;
BEGIN
    SELECT COUNT(*) INTO col_count
    FROM information_schema.columns
    WHERE table_name = 'beauty_knowledge_embeddings'
    AND column_name IN ('document_id', 'document_version', 'chunk_id', 'content_hash', 'fuente', 'seccion');

    SELECT COUNT(*) INTO idx_count
    FROM pg_indexes
    WHERE tablename = 'beauty_knowledge_embeddings'
    AND indexname LIKE '%beauty_knowledge%';

    SELECT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'uk_beauty_knowledge_chunk_identity'
    ) INTO constraint_exists;

    RAISE NOTICE '=== MIGRACIÓN 046 COMPLETADA ===';
    RAISE NOTICE 'Columnas de trazabilidad: %/6', col_count;
    RAISE NOTICE 'Índices relacionados: %', idx_count;
    RAISE NOTICE 'Constraint único chunk identity: %', constraint_exists;
END $$;
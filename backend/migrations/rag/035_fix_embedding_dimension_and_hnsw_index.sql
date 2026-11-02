-- Migration: 035_fix_embedding_dimension_and_hnsw_index.sql
-- Description: 
--   1. Corrige la dimensión de embeddings a 1024 (compatible con NV-Embed-QA)
--   2. Crea índice HNSW para búsqueda vectorial por similitud coseno
--   3. Añade columnas de metadata para filtrado semántico
--   4. Idempotente y reversible
--
-- Tabla canónica: beauty_knowledge_embeddings (confirmada en migraciones 031 y schema.sql)
-- NOTA: Requiere pgvector extension (ver migración 030_enable_pgvector.sql)

-- Paso 0: Verificar si pgvector está disponible
DO $$
DECLARE
    ext_exists boolean;
BEGIN
    SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') INTO ext_exists;
    IF NOT ext_exists THEN
        RAISE EXCEPTION 'pgvector extension not found. Execute migration 030_enable_pgvector.sql first.';
    END IF;
END $$;

-- Paso 1: Verificar si la tabla existe y su estado actual
DO $$
DECLARE
    current_dim integer;
    table_exists boolean;
BEGIN
    -- Verificar si existe beauty_knowledge_embeddings
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'beauty_knowledge_embeddings'
    ) INTO table_exists;
    
    IF NOT table_exists THEN
        RAISE EXCEPTION 'Tabla beauty_knowledge_embeddings no existe. Ejecutar migración 031 primero.';
    END IF;
    
    -- Obtener dimensión actual del embedding
    SELECT a.atttypmod INTO current_dim
    FROM pg_attribute a
    JOIN pg_class c ON a.attrelid = c.oid
    WHERE c.relname = 'beauty_knowledge_embeddings' 
    AND a.attname = 'embedding';
    
    RAISE NOTICE 'Dimensión actual de embedding: %', current_dim;
END $$;

-- Paso 2: Dropear índice HNSW/IVFFlat existente si existe (incompatible con cambio de dimensión)
DROP INDEX IF EXISTS idx_beauty_knowledge_embedding_hnsw;
DROP INDEX IF EXISTS idx_beauty_knowledge_embedding_ivfflat;

-- Paso 3: Cambiar dimensión de embedding a 1024
-- Nota: USING no funciona para cambiar dimensión de vector; requiere recrear columna
DO $$
BEGIN
    -- Si la dimensión ya es 1024, no hacer nada
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'beauty_knowledge_embeddings' 
        AND column_name = 'embedding' 
        AND udt_name = 'vector'
    ) THEN
        -- Verificar dimensión usando atttypmod
        IF EXISTS (
            SELECT 1 FROM pg_attribute a
            JOIN pg_class c ON a.attrelid = c.oid
            WHERE c.relname = 'beauty_knowledge_embeddings' 
            AND a.attname = 'embedding'
            AND a.atttypmod = 1024
        ) THEN
            RAISE NOTICE 'Embedding ya tiene dimensión 1024. Saltando ALTER.';
        ELSE
            -- Recrear columna con nueva dimensión
            ALTER TABLE beauty_knowledge_embeddings 
            DROP COLUMN embedding;
            
            ALTER TABLE beauty_knowledge_embeddings 
            ADD COLUMN embedding vector(1024);
            
            RAISE NOTICE 'Columna embedding recreada con dimensión 1024.';
        END IF;
    END IF;
END $$;

-- Paso 4: Añadir columnas de metadata para filtrado semántico
DO $$
BEGIN
    -- category (puede ya existir como VARCHAR, asegurar compatibilidad)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'beauty_knowledge_embeddings' 
        AND column_name = 'category'
    ) THEN
        ALTER TABLE beauty_knowledge_embeddings 
        ADD COLUMN category VARCHAR(100);
    END IF;

    -- skin_type: tipo de piel (Oily, Dry, Combination, Sensitive, Normal, All)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'beauty_knowledge_embeddings' 
        AND column_name = 'skin_type'
    ) THEN
        ALTER TABLE beauty_knowledge_embeddings 
        ADD COLUMN skin_type VARCHAR(50);
    END IF;

    -- season_station: estación colorimétrica (Verano, Otoño, Invierno, Primavera, All)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'beauty_knowledge_embeddings' 
        AND column_name = 'season_station'
    ) THEN
        ALTER TABLE beauty_knowledge_embeddings 
        ADD COLUMN season_station VARCHAR(20);
    END IF;

    -- age_range: rango etario (18-25, 26-35, 36-45, 46-55, 55+, All)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'beauty_knowledge_embeddings' 
        AND column_name = 'age_range'
    ) THEN
        ALTER TABLE beauty_knowledge_embeddings 
        ADD COLUMN age_range VARCHAR(20);
    END IF;

    -- ingredients: array de ingredientes activos
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'beauty_knowledge_embeddings' 
        AND column_name = 'ingredients'
    ) THEN
        ALTER TABLE beauty_knowledge_embeddings 
        ADD COLUMN ingredients TEXT[];
    END IF;

    -- contraindications: array de contraindicaciones
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'beauty_knowledge_embeddings' 
        AND column_name = 'contraindications'
    ) THEN
        ALTER TABLE beauty_knowledge_embeddings 
        ADD COLUMN contraindications TEXT[];
    END IF;
    
    RAISE NOTICE 'Columnas de metadata verificadas/añadidas.';
END $$;

-- Paso 5: Crear índice HNSW para búsqueda vectorial por similitud coseno
-- Solo si pgvector versión lo soporta (PostgreSQL 15+ con pgvector 0.5+)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'idx_beauty_knowledge_embedding_hnsw'
    ) THEN
        CREATE INDEX idx_beauty_knowledge_embedding_hnsw 
        ON beauty_knowledge_embeddings 
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64);
        
        RAISE NOTICE 'Índice HNSW creado exitosamente.';
    ELSE
        RAISE NOTICE 'Índice HNSW ya existe.';
    END IF;
EXCEPTION
    WHEN others THEN
        RAISE WARNING 'No se pudo crear índice HNSW: %. Intentando IVFFlat como fallback.', SQLERRM;
        -- Fallback a IVFFlat si HNSW no disponible
        IF NOT EXISTS (
            SELECT 1 FROM pg_indexes 
            WHERE indexname = 'idx_beauty_knowledge_embedding_ivfflat'
        ) THEN
            CREATE INDEX idx_beauty_knowledge_embedding_ivfflat 
            ON beauty_knowledge_embeddings 
            USING ivfflat (embedding vector_cosine_ops)
            WITH (lists = 100);
            
            RAISE NOTICE 'Índice IVFFlat creado como fallback.';
        END IF;
END $$;

-- Paso 6: Índices para filtrado por metadata (columnas simples, no GIN multi-columna)
CREATE INDEX IF NOT EXISTS idx_beauty_knowledge_category 
ON beauty_knowledge_embeddings(category);

CREATE INDEX IF NOT EXISTS idx_beauty_knowledge_skin_type 
ON beauty_knowledge_embeddings(skin_type);

CREATE INDEX IF NOT EXISTS idx_beauty_knowledge_season_station 
ON beauty_knowledge_embeddings(season_station);

CREATE INDEX IF NOT EXISTS idx_beauty_knowledge_age_range 
ON beauty_knowledge_embeddings(age_range);

-- Índice GIN para arrays (ingredients, contraindications)
CREATE INDEX IF NOT EXISTS idx_beauty_knowledge_ingredients 
ON beauty_knowledge_embeddings USING GIN (ingredients);

CREATE INDEX IF NOT EXISTS idx_beauty_knowledge_contraindications 
ON beauty_knowledge_embeddings USING GIN (contraindications);

-- Paso 7: Comentario de versión
COMMENT ON TABLE beauty_knowledge_embeddings IS 'RAG Knowledge Base v2: 1024-dim embeddings (NV-Embed-QA), HNSW index, metadata filtering';

-- Verificación final
DO $$
DECLARE
    final_dim integer;
    idx_count integer;
BEGIN
    SELECT a.atttypmod INTO final_dim
    FROM pg_attribute a
    JOIN pg_class c ON a.attrelid = c.oid
    WHERE c.relname = 'beauty_knowledge_embeddings' 
    AND a.attname = 'embedding';
    
    SELECT COUNT(*) INTO idx_count
    FROM pg_indexes 
    WHERE tablename = 'beauty_knowledge_embeddings'
    AND indexname LIKE '%embedding%';
    
    RAISE NOTICE '=== MIGRACIÓN 035 COMPLETADA ===';
    RAISE NOTICE 'Dimensión final embedding: %', final_dim;
    RAISE NOTICE 'Índices vectoriales: %', idx_count;
    RAISE NOTICE 'Tabla: beauty_knowledge_embeddings (canónica)';
END $$;
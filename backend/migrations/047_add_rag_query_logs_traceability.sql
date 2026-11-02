-- Migration: 047_add_rag_query_logs_traceability.sql
-- Description: Añade columnas dedicadas de trazabilidad a rag_query_logs
-- Depende de: 036_create_rag_query_logs.sql (tabla base con JSONB metadata)
-- Objetivo: Trazabilidad mínima R3 - category, threshold_used, filters_applied, all_scores

-- Paso 0: Verificar que la tabla canónica existe
DO $$
DECLARE
    table_exists boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'rag_query_logs'
    ) INTO table_exists;
    
    IF NOT table_exists THEN
        RAISE EXCEPTION 'Tabla rag_query_logs no existe. Ejecutar migración 036 primero.';
    END IF;
END $$;

-- Paso 1: Añadir columnas de trazabilidad dedicada
DO $$
BEGIN
    -- category: categoría de la query (skincare, cabello, cejas, general, etc.)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'rag_query_logs' 
        AND column_name = 'category'
    ) THEN
        ALTER TABLE rag_query_logs 
        ADD COLUMN category VARCHAR(100);
    END IF;

    -- threshold_used: threshold de similitud usado en la búsqueda
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'rag_query_logs' 
        AND column_name = 'threshold_used'
    ) THEN
        ALTER TABLE rag_query_logs 
        ADD COLUMN threshold_used NUMERIC(4,3);
    END IF;

    -- filters_applied: filtros de metadata aplicados (JSONB estructurado)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'rag_query_logs' 
        AND column_name = 'filters_applied'
    ) THEN
        ALTER TABLE rag_query_logs 
        ADD COLUMN filters_applied JSONB;
    END IF;

    -- all_scores: array de todos los scores de similitud (no solo los top-K)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'rag_query_logs' 
        AND column_name = 'all_scores'
    ) THEN
        ALTER TABLE rag_query_logs 
        ADD COLUMN all_scores NUMERIC[];
    END IF;

    -- retrieval_mode: modo de recuperación usado (hnsw, fts, hybrid)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'rag_query_logs' 
        AND column_name = 'retrieval_mode'
    ) THEN
        ALTER TABLE rag_query_logs 
        ADD COLUMN retrieval_mode VARCHAR(20) DEFAULT 'hnsw';
    END IF;

    -- fallback_triggered: si se activó FTS fallback
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'rag_query_logs' 
        AND column_name = 'fallback_triggered'
    ) THEN
        ALTER TABLE rag_query_logs 
        ADD COLUMN fallback_triggered BOOLEAN DEFAULT FALSE;
    END IF;

    -- breaker_state_at_query: estado del circuit breaker al momento de la query
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'rag_query_logs' 
        AND column_name = 'breaker_state_at_query'
    ) THEN
        ALTER TABLE rag_query_logs 
        ADD COLUMN breaker_state_at_query VARCHAR(20); -- 'closed', 'open', 'half_open'
    END IF;

    RAISE NOTICE 'Columnas de trazabilidad añadidas/verificadas.';
END $$;

-- Paso 2: Índices para consultas de trazabilidad y analytics
CREATE INDEX IF NOT EXISTS idx_rag_query_logs_category 
ON rag_query_logs(category);

CREATE INDEX IF NOT EXISTS idx_rag_query_logs_threshold_used 
ON rag_query_logs(threshold_used);

CREATE INDEX IF NOT EXISTS idx_rag_query_logs_retrieval_mode 
ON rag_query_logs(retrieval_mode);

CREATE INDEX IF NOT EXISTS idx_rag_query_logs_fallback_triggered 
ON rag_query_logs(fallback_triggered);

CREATE INDEX IF NOT EXISTS idx_rag_query_logs_created_at_category 
ON rag_query_logs(created_at, category);

-- Paso 3: Comentarios de documentación
COMMENT ON COLUMN rag_query_logs.category IS 'Categoría de la query: skincare, cabello, cejas, general, etc. (desde qualityGates.js)';
COMMENT ON COLUMN rag_query_logs.threshold_used IS 'Threshold de similitud usado en la búsqueda vectorial (ej: 0.45, 0.70)';
COMMENT ON COLUMN rag_query_logs.filters_applied IS 'Filtros de metadata aplicados en la búsqueda (JSONB: {category: "skincare", sourceType: "manual"})';
COMMENT ON COLUMN rag_query_logs.all_scores IS 'Array con TODOS los scores de similitud de chunks candidatos (para análisis recall/precision)';
COMMENT ON COLUMN rag_query_logs.retrieval_mode IS 'Modo de recuperación: hnsw (vector), fts (full-text), hybrid (ambos)';
COMMENT ON COLUMN rag_query_logs.fallback_triggered IS 'TRUE si se activó FTS fallback por error en embedding/HNSW';
COMMENT ON COLUMN rag_query_logs.breaker_state_at_query IS 'Estado del circuit breaker NVIDIA al momento: closed, open, half_open';

-- Paso 4: Verificación final
DO $$
DECLARE
    col_count integer;
    idx_count integer;
BEGIN
    SELECT COUNT(*) INTO col_count
    FROM information_schema.columns
    WHERE table_name = 'rag_query_logs'
    AND column_name IN ('category', 'threshold_used', 'filters_applied', 'all_scores', 'retrieval_mode', 'fallback_triggered', 'breaker_state_at_query');

    SELECT COUNT(*) INTO idx_count
    FROM pg_indexes
    WHERE tablename = 'rag_query_logs'
    AND indexname LIKE '%rag_query_logs%';

    RAISE NOTICE '=== MIGRACIÓN 047 COMPLETADA ===';
    RAISE NOTICE 'Columnas de trazabilidad: %/7', col_count;
    RAISE NOTICE 'Índices relacionados: %', idx_count;
END $$;
-- Migration 036: Create rag_query_logs table for RAG query tracing
-- Description: Tabla para almacenar logs estructurados de consultas RAG
-- Permite análisis de calidad, evaluación RAGAS, métricas de latencia, etc.
-- 
-- NOTA: Esta tabla es OPCIONAL para el funcionamiento del sistema.
-- El ragLogger.js tiene fallback a archivo/console si la tabla no existe.
-- Ejecutar con: npx knex migrate:latest

-- Tabla principal de logs RAG
CREATE TABLE IF NOT EXISTS rag_query_logs (
  id SERIAL PRIMARY KEY,
  trace_id UUID NOT NULL,
  user_id_hash VARCHAR(16),
  query_sanitized TEXT,
  chunks_retrieved INTEGER,
  top_score NUMERIC(5,4),
  llm_used VARCHAR(20),
  total_latency_ms INTEGER,
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Índices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_rag_logs_trace ON rag_query_logs (trace_id);
CREATE INDEX IF NOT EXISTS idx_rag_logs_user ON rag_query_logs (user_id_hash);
CREATE INDEX IF NOT EXISTS idx_rag_logs_created ON rag_query_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_rag_logs_llm ON rag_query_logs (llm_used);
CREATE INDEX IF NOT EXISTS idx_rag_logs_error ON rag_query_logs (error) WHERE error IS NOT NULL;

-- Comentario de la tabla
COMMENT ON TABLE rag_query_logs IS 'Logs estructurados de consultas RAG para trazabilidad, evaluación y debug';

-- Verificación final
DO $$
DECLARE
    table_exists boolean;
    idx_count integer;
BEGIN
    -- Verificar tabla
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'rag_query_logs'
    ) INTO table_exists;
    
    -- Verificar índices
    SELECT COUNT(*) INTO idx_count
    FROM pg_indexes 
    WHERE tablename = 'rag_query_logs';
    
    RAISE NOTICE '=== MIGRACIÓN 036 COMPLETADA ===';
    RAISE NOTICE 'Tabla rag_query_logs existe: %', table_exists;
    RAISE NOTICE 'Índices creados: %', idx_count;
    RAISE NOTICE 'NOTA: Tabla opcional - logger tiene fallback a archivo si no existe';
END $$;
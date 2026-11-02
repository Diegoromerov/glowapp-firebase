-- 115_rag_search_vector.sql · FASE 2
-- Columna generada con el tsvector del chunk.
--
-- El híbrido calculaba `to_tsvector('spanish', title || content)` en cada fila y en cada
-- consulta para el WHERE y otra vez para el rank: p50 1.431 ms. Con la columna generada
-- el vector se calcula al escribir y solo se lee al buscar.
--
-- OJO: la expresión debe coincidir con la de los índices/queries o el planner no la usa.

-- Sin workers paralelos: el build del GIN muere con
-- "could not resize shared memory segment ... No space left on device" (mismo fallo que en 076).
SET max_parallel_maintenance_workers = 0;
SET maintenance_work_mem = '256MB';

ALTER TABLE beauty_knowledge_embeddings
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('spanish', coalesce(title, '') || ' ' || coalesce(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS idx_beauty_knowledge_search_vector
  ON beauty_knowledge_embeddings USING gin (search_vector);

DO $$
DECLARE n integer;
BEGIN
    SELECT count(*) INTO n FROM beauty_knowledge_embeddings WHERE search_vector IS NOT NULL;
    RAISE NOTICE '=== 115 COMPLETADA ===';
    RAISE NOTICE 'Filas con search_vector: %', n;
END $$;

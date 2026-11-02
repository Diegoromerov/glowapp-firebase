-- 114_rag_fts_index.sql · FASE 2
-- Índice GIN para la rama léxica del híbrido.
--
-- Sin él, `to_tsvector('spanish', title || content)` se calcula sobre las 5.619 filas
-- en cada consulta: medido p50 1.036 ms en el híbrido frente a 242 ms en vectorial.
-- La expresión debe ser IDÉNTICA a la de ragService.runLexicalSearch o el planner
-- no usa el índice.

CREATE INDEX IF NOT EXISTS idx_beauty_knowledge_fts
  ON beauty_knowledge_embeddings
  USING gin (to_tsvector('spanish', coalesce(title, '') || ' ' || coalesce(content, '')));

DO $$
BEGIN
    RAISE NOTICE '=== 114 COMPLETADA ===';
    RAISE NOTICE 'Índice fts: %',
        (SELECT count(*) FROM pg_indexes WHERE indexname = 'idx_beauty_knowledge_fts');
END $$;

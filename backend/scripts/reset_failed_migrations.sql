-- Script para re-aplicar migraciones que fallaron por pgvector
-- Ejecutar en la BD de Railway ANTES del próximo deploy
-- psql -d railway -f reset_failed_migrations.sql

DELETE FROM schema_migrations 
WHERE filename IN (
  '035_fix_embedding_dimension_and_hnsw_index.sql',
  '068_force_rls_strict_isolation.sql', 
  '076_rag_embedding_dimension_2048.sql'
);

-- Verificar
SELECT filename, applied_at FROM schema_migrations 
WHERE filename IN (
  '035_fix_embedding_dimension_and_hnsw_index.sql',
  '068_force_rls_strict_isolation.sql', 
  '076_rag_embedding_dimension_2048.sql'
);
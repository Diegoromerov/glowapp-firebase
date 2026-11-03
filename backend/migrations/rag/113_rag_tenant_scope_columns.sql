-- Migration: 113_rag_tenant_scope_columns.sql
-- Cierre FASE 0 del RAG — restaurar las columnas de alcance que el código ya usa.
--
-- PROBLEMA
--   `ragService` arma el WHERE con `tenant_id`, `deleted_at` y `expires_at`, y el
--   SELECT incluye `tenant_id` y `expires_at`. La base RAG NUNCA recibió esas
--   columnas: su migración (`080_rag_rls_multi_tenant_hardening.sql`) ya no existe
--   en el repo y se aplicó contra la base PRINCIPAL (donde la tabla tiene 6 filas
--   vestigiales), no contra la base RAG (5.619 chunks reales).
--
--   Resultado medido: toda consulta falla con `column "tenant_id" does not exist`
--   en la ruta vectorial Y en el fallback full-text → el RAG devuelve SIEMPRE [].
--   No era el umbral: la búsqueda no llegaba a ejecutarse.
--
-- SOLUCIÓN
--   Añadir las tres columnas con el mismo tipo que en la base principal
--   (`tenant_id INTEGER`, `deleted_at`/`expires_at` TIMESTAMPTZ). Las 5.619 filas
--   quedan con `tenant_id NULL`, que el código interpreta como conocimiento GLOBAL
--   visible para todos los tenants — el comportamiento correcto para el corpus
--   canónico compartido.
--
--   No se habilita RLS aquí: el aislamiento viaja en el WHERE del servicio
--   (`appendTenantCondition`). RLS requeriría el GUC `app.tenant_id` fijado por
--   conexión, que el pool del RAG no establece; habilitarlo sin eso dejaría las
--   consultas en cero otra vez.
--
-- Idempotente: todo ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.

ALTER TABLE beauty_knowledge_embeddings
  ADD COLUMN IF NOT EXISTS tenant_id INTEGER,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;

-- El filtro de alcance del servicio: (tenant_id IS NULL OR tenant_id = $n)
CREATE INDEX IF NOT EXISTS idx_beauty_knowledge_tenant
  ON beauty_knowledge_embeddings (tenant_id);

-- Vigencia: el retrieval siempre exige deleted_at IS NULL y expires_at vigente
CREATE INDEX IF NOT EXISTS idx_beauty_knowledge_visibility
  ON beauty_knowledge_embeddings (deleted_at, expires_at);

COMMENT ON COLUMN beauty_knowledge_embeddings.tenant_id IS
  'NULL = conocimiento global visible para todos los tenants. El filtrado lo aplica ragService.appendTenantCondition.';

-- Verificación
DO $$
DECLARE
    faltantes integer;
    globales integer;
BEGIN
    SELECT count(*) INTO faltantes
    FROM (VALUES ('tenant_id'), ('deleted_at'), ('expires_at')) AS req(col)
    WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'beauty_knowledge_embeddings' AND column_name = req.col
    );

    SELECT count(*) INTO globales
    FROM beauty_knowledge_embeddings WHERE tenant_id IS NULL;

    RAISE NOTICE '=== 113 COMPLETADA ===';
    RAISE NOTICE 'Columnas faltantes: % (esperado 0)', faltantes;
    RAISE NOTICE 'Filas con tenant_id NULL (globales): %', globales;
END $$;

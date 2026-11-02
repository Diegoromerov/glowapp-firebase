-- backend/migrations/048_alter_rag_chunk_identity_types.sql
-- CICLO 09 — R5-B DESBLOQUEO
--
-- PROBLEMA (demostrado en CICLO 08):
--   corpus canónico aprobado (R5-A) tiene chunk_ids de hasta 125 caracteres
--   1,279 / 5,619 chunk_ids (22.8%) superan 64 caracteres
--   13 / 65 expected_chunks también superan 64
--   El schema actual: chunk_id VARCHAR(64) (migración 046) NO puede alojarlos
--
-- SOLUCIÓN:
--   Ampliar chunk_id y document_id a TEXT para alojar la identidad canónica
--   completa SIN modificar identidades (regla sección 9: no recortes, no hashes,
--   no IDs alternativos).
--
-- POR QUÉ NO SE EDITA 046:
--   046 ya fue aplicada en BD local (UK activa). Editar una migración aplicada
--   NO actualiza la BD existente; se requiere migración incremental nueva.
--
-- NOTA: el ALTER de VARCHAR(n) → TEXT es no destructivo (no pierde datos,
--   no toca índices ni la UK existente — PG la mantiene automáticamente).

BEGIN;

-- chunk_id: VARCHAR(64) → TEXT (1,279 IDs canónicos lo exigen, máx real 125 chars)
ALTER TABLE beauty_knowledge_embeddings
  ALTER COLUMN chunk_id TYPE TEXT;

-- document_id: VARCHAR(255) → TEXT (coherencia; máx real 39 chars pero
--   futuros corpus podrían usar IDs más largos; TEXT evita otra migración)
ALTER TABLE beauty_knowledge_embeddings
  ALTER COLUMN document_id TYPE TEXT;

-- La UK uk_beauty_knowledge_chunk_identity (document_id, chunk_id) se mantiene
-- automáticamente al cambiar los tipos (constraint, no dependiente de longitud).

COMMIT;

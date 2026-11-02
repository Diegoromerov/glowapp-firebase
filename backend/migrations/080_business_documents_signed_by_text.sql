-- 080_business_documents_signed_by_text.sql
--
-- Alinea `business_documents.signed_by` con lo que el código realmente guarda: un NOMBRE.
--
-- PROBLEMA
--   `012_business_engine.sql` declaró `signed_by INTEGER REFERENCES usuarios(id)`, pero el
--   camino de firma le pasa siempre una cadena:
--     · documentGeneratorService.signDocument() →
--         businessRepository.updateDocumentSignature(docId, 'SIGNED', signerName, hash)
--         y `signerName` es el nombre del firmante (o el fallback `Prestador (${providerId})`).
--     · El contrato de la API lo fija: businessAdminDocs.integration TEST 08 espera
--         signRes.body.data.signedBy === 'Peluquería Alpha Rep. Legal'
--
--   Con la columna en INTEGER, en producción `POST /api/v1/business/documents/:id/sign`
--   falla con:  invalid input syntax for type integer: "Peluquería Alpha Rep. Legal"
--   (reproducido en local; ver docs/audit/DEUDA-TECNICA-GITHUB-2026-10-08.md §0.b).
--
-- DECISIÓN
--   Se cambia la columna a texto en vez de cambiar el código para guardar el id, porque el
--   nombre del firmante es el dato que la API expone y el que exige el contrato. Si algún
--   día se quiere además el id, va en una columna aparte (`signed_by_user_id`), no aquí.
--
-- IDEMPOTENTE: sólo actúa si el tipo actual sigue siendo integer.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'business_documents'
       AND column_name  = 'signed_by'
       AND data_type    = 'integer'
  ) THEN
    -- La FK a usuarios(id) deja de ser válida cuando la columna pasa a guardar un nombre.
    ALTER TABLE public.business_documents
      DROP CONSTRAINT IF EXISTS business_documents_signed_by_fkey;

    ALTER TABLE public.business_documents
      ALTER COLUMN signed_by TYPE VARCHAR(150) USING signed_by::text;

    RAISE NOTICE 'business_documents.signed_by: integer -> varchar(150)';
  ELSE
    RAISE NOTICE 'business_documents.signed_by: ya es texto (o la tabla no existe) — sin cambios';
  END IF;
END $$;

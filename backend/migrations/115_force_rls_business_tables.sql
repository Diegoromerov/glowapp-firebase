-- 115_force_rls_business_tables.sql
-- E-02c (D-GL-027) — cierre de la brecha entre el arnés de pruebas y producción.
--
-- QUÉ PASA HOY (medido en producción el 2026-10-26):
--   business_documents, business_evidences, business_findings, business_profiles,
--   business_tasks y document_audit_logs tienen RLS habilitada y su política
--   `tenant_isolation_*`, pero `relforcerowsecurity = false`.
--   `business_requirements` no tiene RLS en absoluto (es catálogo global).
--
-- El arnés RLS sí las fuerza (prepareRlsDatabase), así que las pruebas eran más
-- estrictas que la base real. Esta migración alinea: ninguna tabla con
-- `tenant_id` queda sin FORCE ni sin política.
--
-- ALCANCE DEL CAMBIO HOY: la aplicación conecta como `postgres` (superusuario con
-- BYPASSRLS), así que FORCE no altera ninguna consulta en curso. Importa el día
-- que T-017 cambie a un rol sin bypass: a partir de ahí el propietario de la
-- tabla tampoco se salta las políticas.
--
-- Idempotente: `IF NOT EXISTS` / comprobaciones en el catálogo, se puede aplicar
-- dos veces sin efecto adicional.

BEGIN;

-- 1. Política de catálogo para business_requirements (global, legible por todos).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relname = 'business_requirements'
  ) THEN
    ALTER TABLE business_requirements ENABLE ROW LEVEL SECURITY;
    CREATE POLICY catalog_business_requirements ON business_requirements
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 2. FORCE en toda tabla con tenant_id que ya tenga política.
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND NOT c.relforcerowsecurity
       AND EXISTS (SELECT 1 FROM information_schema.columns i
                    WHERE i.table_schema = 'public' AND i.table_name = c.relname
                      AND i.column_name = 'tenant_id')
       AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
  LOOP
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t.relname);
  END LOOP;
END $$;

COMMIT;

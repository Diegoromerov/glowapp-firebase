-- 119: Forzar aislamiento RLS en retention_policies
-- La tabla se creó en 032_create_retention_policies.sql y quedó con tenant_id
-- pero sin ENABLE/FORCE ROW LEVEL SECURITY ni política, lo que rompía la
-- aserción de aislamiento de prepareRlsDatabase.js (29/30 tablas).
DO $$
BEGIN
  IF to_regclass('public.retention_policies') IS NULL THEN
    RAISE NOTICE '119: retention_policies no existe; nada que hacer.';
    RETURN;
  END IF;

  ALTER TABLE public.retention_policies ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.retention_policies FORCE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS tenant_isolation_retention_policies ON public.retention_policies;
  CREATE POLICY tenant_isolation_retention_policies ON public.retention_policies
    FOR ALL
    USING (tenant_id = COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::int, 0))
    WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::int, 0));
END $$;

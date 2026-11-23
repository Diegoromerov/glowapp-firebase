-- Permite que cada prestador administre su propia billetera aun cuando no
-- pertenezca a un tenant. Conserva además el acceso ya previsto para filas
-- visibles dentro del tenant autenticado.
DO $$
DECLARE p RECORD;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'provider_wallet'
  ) THEN
    RETURN;
  END IF;

  -- El runner de RLS ha usado varios nombres históricos para estas políticas.
  -- Eliminar todas evita que una política permisiva anterior anule la nueva.
  FOR p IN
    SELECT policyname FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'provider_wallet'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.provider_wallet', p.policyname);
  END LOOP;
END $$;

CREATE POLICY provider_wallet_owner_select ON public.provider_wallet
  FOR SELECT USING (
    provider_id = app_current_user_id()
    OR (tenant_id IS NOT NULL AND tenant_id = app_current_tenant_id())
  );

CREATE POLICY provider_wallet_owner_insert ON public.provider_wallet
  FOR INSERT WITH CHECK (
    provider_id = app_current_user_id()
    OR (tenant_id IS NOT NULL AND tenant_id = app_current_tenant_id())
  );

CREATE POLICY provider_wallet_owner_update ON public.provider_wallet
  FOR UPDATE USING (
    provider_id = app_current_user_id()
    OR (tenant_id IS NOT NULL AND tenant_id = app_current_tenant_id())
  ) WITH CHECK (
    provider_id = app_current_user_id()
    OR (tenant_id IS NOT NULL AND tenant_id = app_current_tenant_id())
  );

CREATE POLICY provider_wallet_owner_delete ON public.provider_wallet
  FOR DELETE USING (
    provider_id = app_current_user_id()
    OR (tenant_id IS NOT NULL AND tenant_id = app_current_tenant_id())
  );

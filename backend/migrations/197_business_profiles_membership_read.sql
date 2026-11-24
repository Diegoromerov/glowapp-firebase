-- 197_business_profiles_membership_read.sql
-- Permite que el usuario autenticado lea el perfil de negocio al que pertenece.
--
-- La política tenant_isolation_business_profiles compara tenant_id con
-- app.tenant_id. En el alta SaaS inicial, la sesión puede tener un tenant_id
-- legado (o carecer de él) que no coincide con business_profiles.tenant_id.
-- La sede y la membership del dueño ya existen en ese punto, pero bootstrap y
-- saasContext no podían leer el perfil y concluían erróneamente que no había
-- tenant.
--
-- El acceso se limita al proveedor propietario o a una membership activa del
-- sujeto autenticado. Las policies permisivas se combinan con OR; la política
-- de aislamiento por tenant sigue aplicando a los demás perfiles.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rls_user') THEN
    DROP POLICY IF EXISTS business_profiles_active_membership_read
      ON public.business_profiles;

    CREATE POLICY business_profiles_active_membership_read
      ON public.business_profiles
      FOR SELECT
      TO app_rls_user
      USING (
        provider_id = app_current_user_id()
        OR EXISTS (
          SELECT 1
          FROM public.memberships m
          WHERE m.business_profile_id = business_profiles.id
            AND m.user_id = app_current_user_id()
            AND m.status = 'ACTIVE'
        )
      );
  END IF;
END
$$;

COMMIT;

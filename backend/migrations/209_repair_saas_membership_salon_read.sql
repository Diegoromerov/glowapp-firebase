-- Repair 208 when it was recorded before its prerequisites existed.
-- Unlike the original migration, missing prerequisites fail deployment startup
-- instead of silently recording a migration that installed no policy.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rls_user') THEN
    RAISE EXCEPTION 'Required role app_rls_user is missing';
  END IF;
  IF to_regclass('public.salones') IS NULL
     OR to_regclass('public.memberships') IS NULL
     OR to_regprocedure('public.app_current_user_id()') IS NULL THEN
    RAISE EXCEPTION 'Required SaaS membership salon-read schema is missing';
  END IF;

  DROP POLICY IF EXISTS salones_active_membership_read ON public.salones;
  CREATE POLICY salones_active_membership_read
    ON public.salones
    FOR SELECT
    TO app_rls_user
    USING (
      business_profile_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.memberships m
        WHERE m.business_profile_id = salones.business_profile_id
          AND m.user_id = app_current_user_id()
          AND m.status = 'ACTIVE'
      )
    );
END
$$;

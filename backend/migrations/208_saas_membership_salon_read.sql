-- Allow an authenticated SaaS member to read the salon row linked to their
-- active business profile. The existing tenant_id-only policy hides salons
-- whose owner has an active SaaS membership but no matching legacy app tenant.
-- Keep this limited to active memberships and SELECT; tenant isolation remains
-- in force for every other salon.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rls_user')
     AND to_regclass('public.salones') IS NOT NULL
     AND to_regclass('public.memberships') IS NOT NULL THEN
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
  END IF;
END
$$;

COMMIT;

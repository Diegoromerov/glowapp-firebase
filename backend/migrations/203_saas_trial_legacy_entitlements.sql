-- Preserve the offer already granted to existing trial tenants while giving
-- new signups only the capabilities that can be delivered today.

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.business_profiles'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%saas_plan%'
  LOOP
    EXECUTE format('ALTER TABLE public.business_profiles DROP CONSTRAINT %I', constraint_name);
  END LOOP;

  ALTER TABLE public.business_profiles
    ADD CONSTRAINT business_profiles_saas_plan_check
    CHECK (saas_plan IN (
      'FREE_TRIAL', 'FREE_TRIAL_LEGACY', 'FREEMIUM', 'BASIC', 'GROWTH', 'PRO', 'ENTERPRISE'
    ));
END $$;

-- Keep the same rights and trial window for all salons that had already
-- received FREE_TRIAL before this catalog correction.
UPDATE business_profiles
SET saas_plan = 'FREE_TRIAL_LEGACY',
    saas_trial_started_at = COALESCE(saas_trial_started_at, NOW()),
    saas_trial_ends_at = COALESCE(saas_trial_ends_at, NOW() + INTERVAL '14 days'),
    updated_at = NOW()
WHERE saas_plan = 'FREE_TRIAL';

UPDATE salones
SET plan_saas = 'FREE_TRIAL_LEGACY',
    updated_at = NOW()
WHERE plan_saas = 'FREE_TRIAL';

COMMENT ON COLUMN business_profiles.saas_plan IS
  'Plan SaaS actual. FREE_TRIAL_LEGACY conserva la oferta concedida antes de la corrección del catálogo.';

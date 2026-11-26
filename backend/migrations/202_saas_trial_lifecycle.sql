-- Persist the free-trial lifecycle for SaaS tenants.
-- Existing FREE_TRIAL tenants receive a fresh 14-day transition window from
-- migration time; no existing salon loses access on deployment.

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS saas_trial_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS saas_trial_ends_at TIMESTAMPTZ;

UPDATE business_profiles bp
SET saas_trial_started_at = NOW(),
    saas_trial_ends_at = NOW() + INTERVAL '14 days'
WHERE bp.saas_plan = 'FREE_TRIAL'
  AND bp.saas_trial_ends_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM subscriptions s
    WHERE s.tenant_id = bp.id
      AND s.plan <> 'FREE_TRIAL'
      AND s.status IN ('active', 'trialing', 'past_due', 'incomplete')
  );

COMMENT ON COLUMN business_profiles.saas_trial_started_at IS
  'Inicio de la prueba gratuita del tenant SaaS; NULL para planes sin prueba.';
COMMENT ON COLUMN business_profiles.saas_trial_ends_at IS
  'Vencimiento de la prueba gratuita; al vencer el tenant pasa a FREEMIUM.';

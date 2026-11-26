-- SaaS Wompi recurring billing: payment source is encrypted at rest; every
-- charge has a unique reference and immutable billing-attempt ledger row.
BEGIN;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS wompi_payment_source_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS wompi_payment_source_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS wompi_card_brand VARCHAR(32),
  ADD COLUMN IF NOT EXISTS wompi_card_last_four CHAR(4),
  ADD COLUMN IF NOT EXISTS billing_provider VARCHAR(20),
  ADD COLUMN IF NOT EXISTS billing_email VARCHAR(254),
  ADD COLUMN IF NOT EXISTS billing_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS billing_consent_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS billing_consent_ip INET,
  ADD COLUMN IF NOT EXISTS billing_consent_version VARCHAR(40),
  ADD COLUMN IF NOT EXISTS billing_next_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS billing_retry_count SMALLINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.saas_billing_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  plan VARCHAR(50) NOT NULL CHECK (plan IN ('FREE_TRIAL','FREEMIUM','BASIC','PRO','ENTERPRISE')),
  purpose VARCHAR(24) NOT NULL CHECK (purpose IN ('INITIAL','RENEWAL','PLAN_CHANGE')),
  status VARCHAR(24) NOT NULL CHECK (status IN ('CREATED','PENDING','APPROVED','DECLINED','ERROR','UNKNOWN')),
  reference VARCHAR(100) NOT NULL UNIQUE,
  wompi_transaction_id VARCHAR(255) UNIQUE,
  amount_in_cents INTEGER NOT NULL CHECK (amount_in_cents > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'COP' CHECK (currency = 'COP'),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  payment_source_ciphertext TEXT,
  payment_source_type VARCHAR(20),
  billing_email VARCHAR(254) NOT NULL,
  card_brand VARCHAR(32),
  card_last_four CHAR(4),
  consent_at TIMESTAMPTZ NOT NULL,
  consent_user_id INTEGER NOT NULL,
  consent_ip INET,
  consent_version VARCHAR(40) NOT NULL,
  error_code VARCHAR(80),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  CHECK (period_end > period_start)
);

CREATE INDEX IF NOT EXISTS idx_saas_billing_attempts_tenant_created
  ON public.saas_billing_attempts (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saas_billing_attempts_subscription_period
  ON public.saas_billing_attempts (subscription_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_saas_billing_attempts_retry
  ON public.saas_billing_attempts (status, created_at)
  WHERE status IN ('CREATED','PENDING','UNKNOWN');
CREATE UNIQUE INDEX IF NOT EXISTS uq_saas_billing_attempt_one_open_per_tenant
  ON public.saas_billing_attempts (tenant_id)
  WHERE status IN ('CREATED','PENDING','UNKNOWN');

ALTER TABLE public.saas_billing_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_billing_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_saas_billing_attempts ON public.saas_billing_attempts;
CREATE POLICY tenant_isolation_saas_billing_attempts
  ON public.saas_billing_attempts FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.business_profile_id', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('app.business_profile_id', true), ''));

GRANT SELECT, INSERT, UPDATE ON public.saas_billing_attempts TO app_rls_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saas_billing_attempts TO app_system;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_system;

COMMIT;

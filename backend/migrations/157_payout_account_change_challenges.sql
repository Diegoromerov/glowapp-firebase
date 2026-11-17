-- 088_payout_account_change_challenges.sql
-- Reto efímero de segundo factor, ligado a identidad y destino bancario.
CREATE TABLE IF NOT EXISTS payout_account_change_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tenant_id INTEGER,
  codigo_hash VARCHAR(255) NOT NULL,
  destino_hash CHAR(64) NOT NULL,
  creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expira_at TIMESTAMPTZ NOT NULL,
  intentos_fallidos INTEGER NOT NULL DEFAULT 0 CHECK (intentos_fallidos >= 0),
  usado_at TIMESTAMPTZ,
  ip_generacion INET
);

CREATE INDEX IF NOT EXISTS idx_payout_account_challenge_owner
  ON payout_account_change_challenges (provider_id, creado_at DESC);
CREATE INDEX IF NOT EXISTS idx_payout_account_challenge_expiry
  ON payout_account_change_challenges (expira_at) WHERE usado_at IS NULL;

ALTER TABLE payout_account_change_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_account_change_challenges FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payout_account_change_challenge_tenant ON payout_account_change_challenges;
CREATE POLICY payout_account_change_challenge_tenant
  ON payout_account_change_challenges
  USING (tenant_id = app_current_tenant_id() OR provider_id = app_current_user_id())
  WITH CHECK (tenant_id = app_current_tenant_id() OR provider_id = app_current_user_id());

DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['app_rls_user', 'app_owner', 'app_system', 'app_runtime_user', 'beauty_app_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON payout_account_change_challenges TO %I', r);
    END IF;
  END LOOP;
END $$;

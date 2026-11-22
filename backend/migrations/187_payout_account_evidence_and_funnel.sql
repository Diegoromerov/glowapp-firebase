-- Fase 3: verificación excepcional con soporte y medición del flujo de retiro.
-- No almacena documentos sin solicitud administrativa explícita.

CREATE TABLE IF NOT EXISTS payout_account_flow_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tenant_id INTEGER,
  status VARCHAR(16) NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'SUBMITTED', 'ABANDONED', 'APPROVED', 'REJECTED')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  support_opened_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  transfer_failures INTEGER NOT NULL DEFAULT 0 CHECK (transfer_failures >= 0)
);

CREATE INDEX IF NOT EXISTS idx_payout_flow_provider_started
  ON payout_account_flow_sessions (provider_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_payout_flow_metrics
  ON payout_account_flow_sessions (started_at, status);

ALTER TABLE provider_wallet
  ADD COLUMN IF NOT EXISTS cuenta_flow_session_id UUID
    REFERENCES payout_account_flow_sessions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS payout_account_review_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tenant_id INTEGER,
  flow_session_id UUID REFERENCES payout_account_flow_sessions(id) ON DELETE SET NULL,
  account_fingerprint CHAR(64) NOT NULL,
  reason_code VARCHAR(32) NOT NULL CHECK (reason_code IN (
    'TITULAR_NO_COINCIDE', 'RECHAZO_TRANSFERENCIA', 'REVISION_RIESGO'
  )),
  status VARCHAR(16) NOT NULL DEFAULT 'REQUESTED'
    CHECK (status IN ('REQUESTED', 'UPLOADED', 'REVIEWED', 'PURGED', 'EXPIRED')),
  requested_by INTEGER NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_at TIMESTAMPTZ,
  reviewed_by INTEGER,
  reviewed_at TIMESTAMPTZ,
  purge_at TIMESTAMPTZ,
  file_ciphertext TEXT,
  file_mime_type VARCHAR(32),
  file_bytes INTEGER CHECK (file_bytes IS NULL OR file_bytes BETWEEN 1 AND 1500000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (status = 'UPLOADED' AND file_ciphertext IS NOT NULL AND uploaded_at IS NOT NULL)
    OR status <> 'UPLOADED'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_evidence_open_request
  ON payout_account_review_evidence (provider_id)
  WHERE status IN ('REQUESTED', 'UPLOADED');
CREATE INDEX IF NOT EXISTS idx_payout_evidence_retention
  ON payout_account_review_evidence (purge_at)
  WHERE file_ciphertext IS NOT NULL;

ALTER TABLE payout_account_flow_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_account_flow_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payout_account_flow_owner ON payout_account_flow_sessions;
CREATE POLICY payout_account_flow_owner ON payout_account_flow_sessions
  USING (tenant_id = app_current_tenant_id() OR provider_id = app_current_user_id())
  WITH CHECK (tenant_id = app_current_tenant_id() OR provider_id = app_current_user_id());

ALTER TABLE payout_account_review_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_account_review_evidence FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payout_account_evidence_owner ON payout_account_review_evidence;
CREATE POLICY payout_account_evidence_owner ON payout_account_review_evidence
  USING (tenant_id = app_current_tenant_id() OR provider_id = app_current_user_id())
  WITH CHECK (tenant_id = app_current_tenant_id() OR provider_id = app_current_user_id());

DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['app_rls_user', 'app_owner', 'app_system', 'app_runtime_user', 'beauty_app_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON payout_account_flow_sessions TO %I', r);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON payout_account_review_evidence TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMENT ON TABLE payout_account_review_evidence IS
  'Soporte excepcional de titularidad; solo se crea por solicitud administrativa. Archivo cifrado con PAYOUT_DATA_ENCRYPTION_KEY y eliminado a los 30 días.';
COMMENT ON COLUMN payout_account_review_evidence.file_ciphertext IS
  'Base64 cifrado AES-256-GCM por payoutSensitiveDataService; no registrar ni enviar a analítica.';

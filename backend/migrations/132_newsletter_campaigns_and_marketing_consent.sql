-- 132: consentimiento trazable para marketing y campañas de boletines por lotes.
BEGIN;

CREATE TABLE IF NOT EXISTS marketing_consent_audit (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  granted BOOLEAN NOT NULL,
  source VARCHAR(40) NOT NULL DEFAULT 'account_settings',
  happened_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_marketing_consent_audit_user_time
  ON marketing_consent_audit (user_id, happened_at DESC);

CREATE OR REPLACE FUNCTION audit_marketing_preference_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.marketing_enabled IS TRUE THEN
      INSERT INTO marketing_consent_audit (user_id, granted) VALUES (NEW.user_id, TRUE);
    END IF;
  ELSIF OLD.marketing_enabled IS DISTINCT FROM NEW.marketing_enabled THEN
    INSERT INTO marketing_consent_audit (user_id, granted) VALUES (NEW.user_id, NEW.marketing_enabled);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_marketing_preference ON user_preferences;
CREATE TRIGGER trg_audit_marketing_preference
  AFTER INSERT OR UPDATE OF marketing_enabled ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION audit_marketing_preference_change();

CREATE TABLE IF NOT EXISTS newsletter_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject VARCHAR(160) NOT NULL,
  body_text TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'SENDING', 'COMPLETED', 'PARTIAL')),
  created_by INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS newsletter_deliveries (
  id BIGSERIAL PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES newsletter_campaigns(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED')),
  provider VARCHAR(32),
  provider_message_id VARCHAR(200),
  failure_code VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_newsletter_delivery_queue
  ON newsletter_deliveries (campaign_id, status, id);

CREATE OR REPLACE FUNCTION update_newsletter_delivery_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_newsletter_delivery_updated ON newsletter_deliveries;
CREATE TRIGGER trg_newsletter_delivery_updated
  BEFORE UPDATE ON newsletter_deliveries
  FOR EACH ROW EXECUTE FUNCTION update_newsletter_delivery_timestamp();

COMMENT ON TABLE marketing_consent_audit IS
  'Historial mínimo de autorización/retiro de boletines. No almacena correo ni contenido de campaña.';
COMMENT ON TABLE newsletter_deliveries IS
  'Cola reanudable por lotes; no conserva correo del destinatario y revalida marketing_enabled antes del envío.';

COMMIT;

-- ===========================================================================
-- 108_saas_usage_schema.sql — Métricas de Uso y API Keys SaaS B2B
-- ===========================================================================
-- Idempotente: todo es CREATE ... IF NOT EXISTS
-- Ejecutar DESPUÉS de 107_saas_billing_schema.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Métricas de uso por tenant + feature + período (mensual)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usage_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       VARCHAR(64) NOT NULL,
  feature         VARCHAR(50) NOT NULL
    CHECK (feature IN (
      'MAP_VISIBILITY',
      'ONLINE_BOOKING',
      'TEAM_SEATS',
      'API_CALLS',
      'ADVANCED_ANALYTICS',
      'CUSTOM_BRANDING',
      'WHATSAPP_INTEGRATION',
      'POS_INTEGRATION'
    )),
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  count           INTEGER DEFAULT 0,
  "limit"         INTEGER, -- NULL = ilimitado (nombre reservado: requiere comillas)
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, feature, period_start)
);

CREATE INDEX IF NOT EXISTS idx_usage_metrics_tenant_period ON usage_metrics(tenant_id, period_start);
CREATE INDEX IF NOT EXISTS idx_usage_metrics_feature ON usage_metrics(feature);

-- ---------------------------------------------------------------------------
-- 2. API Keys tenant-scoped para integraciones externas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       VARCHAR(64) NOT NULL,
  name            VARCHAR(100) NOT NULL,
  key_hash        VARCHAR(255) NOT NULL, -- bcrypt hash
  key_prefix      VARCHAR(16) NOT NULL,  -- ej: glsk_live_abc123
  scopes          TEXT[] DEFAULT '{}',   -- ej: '{bookings:read,bookings:write,clients:read}'
  last_used_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);
CREATE UNIQUE INDEX IF NOT EXISTS uq_api_keys_tenant_name ON api_keys(tenant_id, name);

-- ---------------------------------------------------------------------------
-- 3. Trigger updated_at
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_usage_metrics_updated_at'
  ) THEN
    CREATE TRIGGER trg_usage_metrics_updated_at
    BEFORE UPDATE ON usage_metrics
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_api_keys_updated_at'
  ) THEN
    CREATE TRIGGER trg_api_keys_updated_at
    BEFORE UPDATE ON api_keys
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
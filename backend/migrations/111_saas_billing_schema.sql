-- ===========================================================================
-- 111_saas_billing_schema.sql — Esquema de Facturación y Suscripciones SaaS B2B
-- ===========================================================================
-- Idempotente: todo es CREATE ... IF NOT EXISTS
-- Ejecutar DESPUÉS de 012_business_engine.sql (business_profiles existe)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Suscripciones SaaS por tenant
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               VARCHAR(64) NOT NULL,
  stripe_subscription_id  VARCHAR(255) UNIQUE,
  wompi_subscription_id   VARCHAR(255) UNIQUE,
  plan                    VARCHAR(50) NOT NULL
    CHECK (plan IN ('FREE_TRIAL','FREEMIUM','BASIC','PRO','ENTERPRISE')),
  status                  VARCHAR(30) NOT NULL
    CHECK (status IN ('trialing','active','past_due','canceled','incomplete','incomplete_expired')),
  current_period_start    TIMESTAMPTZ NOT NULL,
  current_period_end      TIMESTAMPTZ NOT NULL,
  cancel_at_period_end    BOOLEAN DEFAULT FALSE,
  canceled_at             TIMESTAMPTZ,
  trial_start             TIMESTAMPTZ,
  trial_end               TIMESTAMPTZ,
  metadata                JSONB DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_id ON subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_wompi_id ON subscriptions(wompi_subscription_id);

-- ---------------------------------------------------------------------------
-- 2. Facturas (invoices) — append-only, inmutables tras emisión
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id       UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  tenant_id             VARCHAR(64) NOT NULL,
  stripe_invoice_id     VARCHAR(255) UNIQUE,
  wompi_invoice_id      VARCHAR(255) UNIQUE,
  amount_cents          INTEGER NOT NULL,
  currency              VARCHAR(3) DEFAULT 'COP',
  status                VARCHAR(30) NOT NULL
    CHECK (status IN ('draft','open','paid','void','uncollectible')),
  pdf_url               TEXT,
  period_start          TIMESTAMPTZ,
  period_end            TIMESTAMPTZ,
  paid_at               TIMESTAMPTZ,
  hosted_invoice_url    TEXT,
  invoice_pdf_url       TEXT,
  metadata              JSONB DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_tenant ON invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_subscription ON invoices(subscription_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_stripe_id ON invoices(stripe_invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoices_wompi_id ON invoices(wompi_invoice_id);

-- ---------------------------------------------------------------------------
-- 3. Eventos de webhook procesados (idempotencia)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhook_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        VARCHAR(20) NOT NULL CHECK (provider IN ('stripe','wompi')),
  event_id        VARCHAR(255) NOT NULL,
  event_type      VARCHAR(100) NOT NULL,
  payload_hash    VARCHAR(64) NOT NULL,
  processed_at    TIMESTAMPTZ DEFAULT NOW(),
  result          JSONB DEFAULT '{}'::jsonb,
  error_message   TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_events_provider_event
  ON webhook_events(provider, event_id);

-- ---------------------------------------------------------------------------
-- 4. Trigger updated_at para subscriptions
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_subscriptions_updated_at'
  ) THEN
    CREATE TRIGGER trg_subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- Función genérica update_updated_at_column (si no existe)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;
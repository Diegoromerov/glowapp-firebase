-- ===========================================================================
-- 110_saas_schema_fix_and_complete.sql — Corrige tipos y completa esquema SaaS
-- ===========================================================================
-- Idempotente: todo es CREATE ... IF NOT EXISTS / ALTER TABLE ... IF NOT EXISTS
-- Ejecutar DESPUÉS de 109_saas_tenant_plan.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- NOTA: business_profiles.id es VARCHAR(36) (no UUID).
-- Las migraciones 107 y 108 usan tenant_id VARCHAR(64) que es compatible.
-- Nuestro código nuevo usa UUID - este migración alinea todo a VARCHAR(36)
-- con FK a business_profiles(id) para consistencia.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. CORRECCIÓN: subscriptions — alinear tenant_id a VARCHAR(36) + FK
-- ===========================================================================
-- Si la tabla existe con UUID, la convertimos; si no existe, la creamos bien.

DO $$
BEGIN
  -- Verificar si subscriptions existe y su tenant_id es UUID
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'subscriptions' AND column_name = 'tenant_id' AND data_type = 'uuid'
  ) THEN
    -- Convertir tenant_id de UUID a VARCHAR(36) y añadir FK
    ALTER TABLE subscriptions
      ALTER COLUMN tenant_id TYPE VARCHAR(36) USING tenant_id::text;

    -- Añadir FK si no existe
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_name = 'subscriptions' AND constraint_name = 'fk_subscriptions_tenant'
    ) THEN
      ALTER TABLE subscriptions
        ADD CONSTRAINT fk_subscriptions_tenant
        FOREIGN KEY (tenant_id) REFERENCES business_profiles(id) ON DELETE CASCADE;
    END IF;

    RAISE NOTICE 'subscriptions.tenant_id convertido a VARCHAR(36) con FK';
  ELSE
    -- Tabla no existe o ya es VARCHAR - la creación la maneja 107
    RAISE NOTICE 'subscriptions.tenant_id ya es compatible o tabla no existe';
  END IF;
END $$;

-- ===========================================================================
-- 2. CORRECCIÓN: invoices — alinear tenant_id + subscription_id FK
-- ===========================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'tenant_id' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE invoices
      ALTER COLUMN tenant_id TYPE VARCHAR(36) USING tenant_id::text;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_name = 'invoices' AND constraint_name = 'fk_invoices_tenant'
    ) THEN
      ALTER TABLE invoices
        ADD CONSTRAINT fk_invoices_tenant
        FOREIGN KEY (tenant_id) REFERENCES business_profiles(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_name = 'invoices' AND constraint_name = 'fk_invoices_subscription'
    ) THEN
      ALTER TABLE invoices
        ADD CONSTRAINT fk_invoices_subscription
        FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL;
    END IF;

    RAISE NOTICE 'invoices.tenant_id convertido a VARCHAR(36) con FKs';
  ELSE
    RAISE NOTICE 'invoices.tenant_id ya es compatible o tabla no existe';
  END IF;
END $$;

-- ===========================================================================
-- 3. CORRECCIÓN: usage_metrics — alinear tenant_id a VARCHAR(36) + FK
-- ===========================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'usage_metrics' AND column_name = 'tenant_id' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE usage_metrics
      ALTER COLUMN tenant_id TYPE VARCHAR(36) USING tenant_id::text;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_name = 'usage_metrics' AND constraint_name = 'fk_usage_metrics_tenant'
    ) THEN
      ALTER TABLE usage_metrics
        ADD CONSTRAINT fk_usage_metrics_tenant
        FOREIGN KEY (tenant_id) REFERENCES business_profiles(id) ON DELETE CASCADE;
    END IF;

    RAISE NOTICE 'usage_metrics.tenant_id convertido a VARCHAR(36) con FK';
  ELSE
    RAISE NOTICE 'usage_metrics.tenant_id ya es compatible o tabla no existe';
  END IF;
END $$;

-- ===========================================================================
-- 4. CORRECCIÓN: api_keys — alinear tenant_id a VARCHAR(36) + FK
-- ===========================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'api_keys' AND column_name = 'tenant_id' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE api_keys
      ALTER COLUMN tenant_id TYPE VARCHAR(36) USING tenant_id::text;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_name = 'api_keys' AND constraint_name = 'fk_api_keys_tenant'
    ) THEN
      ALTER TABLE api_keys
        ADD CONSTRAINT fk_api_keys_tenant
        FOREIGN KEY (tenant_id) REFERENCES business_profiles(id) ON DELETE CASCADE;
    END IF;

    RAISE NOTICE 'api_keys.tenant_id convertido a VARCHAR(36) con FK';
  ELSE
    RAISE NOTICE 'api_keys.tenant_id ya es compatible o tabla no existe';
  END IF;
END $$;

-- ===========================================================================
-- 5. CORRECCIÓN: webhook_events — asegurar que existe
-- ===========================================================================
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

-- ===========================================================================
-- 6. NUEVA TABLA: audit_logs — auditoría de acciones admin/automáticas
-- ===========================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  action        VARCHAR(100) NOT NULL,
  target_type   VARCHAR(50),           -- 'tenant', 'subscription', 'platform', 'user'
  target_id     VARCHAR(36),           -- puede ser tenant_id (VARCHAR(36)) o user_id (INTEGER::text)
  metadata      JSONB DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

-- ===========================================================================
-- 7. AÑADIR COLUMNAS FALTANTES EN subscriptions (para compatibilidad código)
-- ===========================================================================
ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'COP';

ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS wompi_customer_id VARCHAR(255);

-- ===========================================================================
-- 8. AÑADIR COLUMNAS FALTANTES EN invoices (para compatibilidad código)
-- ===========================================================================
ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(50) UNIQUE;

ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12,2),
ADD COLUMN IF NOT EXISTS tax NUMERIC(12,2),
ADD COLUMN IF NOT EXISTS total NUMERIC(12,2),
ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS billing_name VARCHAR(200),
ADD COLUMN IF NOT EXISTS billing_email VARCHAR(200),
ADD COLUMN IF NOT EXISTS billing_address TEXT,
ADD COLUMN IF NOT EXISTS billing_tax_id VARCHAR(50),
ADD COLUMN IF NOT EXISTS items JSONB;

-- Índice para invoice_number
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);

-- ===========================================================================
-- 9. AÑADIR COLUMNAS FALTANTES EN usage_metrics (features extendidas)
-- ===========================================================================
-- La CHECK constraint de feature se actualiza en migración separada si hace falta
-- (PostgreSQL no permite ALTER CHECK fácilmente, se hace con DROP+ADD)

DO $$
BEGIN
  -- Verificar si la constraint existe y necesita actualización
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'usage_metrics_feature_check'
  ) THEN
    -- Eliminar y recrear con features extendidas
    ALTER TABLE usage_metrics DROP CONSTRAINT IF EXISTS usage_metrics_feature_check;
    ALTER TABLE usage_metrics
      ADD CONSTRAINT usage_metrics_feature_check
      CHECK (feature IN (
        'MAP_VISIBILITY',
        'ONLINE_BOOKING',
        'TEAM_SEATS',
        'API_CALLS',
        'ADVANCED_ANALYTICS',
        'CUSTOM_BRANDING',
        'WHATSAPP_INTEGRATION',
        'POS_INTEGRATION'
      ));
    RAISE NOTICE 'usage_metrics feature constraint actualizada';
  ELSE
    -- Si no existe constraint (tabla creada por 108), añadirla
    ALTER TABLE usage_metrics
      ADD CONSTRAINT usage_metrics_feature_check
      CHECK (feature IN (
        'MAP_VISIBILITY',
        'ONLINE_BOOKING',
        'TEAM_SEATS',
        'API_CALLS',
        'ADVANCED_ANALYTICS',
        'CUSTOM_BRANDING',
        'WHATSAPP_INTEGRATION',
        'POS_INTEGRATION'
      ));
    RAISE NOTICE 'usage_metrics feature constraint creada';
  END IF;
END $$;

-- ===========================================================================
-- 10. AÑADIR COLUMNAS FALTANTES EN api_keys (scopes array, revoked_by, created_by)
-- ===========================================================================
ALTER TABLE api_keys
ADD COLUMN IF NOT EXISTS scopes TEXT[] DEFAULT '{read}',
ADD COLUMN IF NOT EXISTS revoked_by INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;

-- ===========================================================================
-- 11. TRIGGERS updated_at (usando función genérica existente)
-- ===========================================================================
DO $$
BEGIN
  -- subscriptions
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_subscriptions_updated_at'
  ) THEN
    CREATE TRIGGER trg_subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;

  -- invoices
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_invoices_updated_at'
  ) THEN
    CREATE TRIGGER trg_invoices_updated_at
    BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;

  -- usage_metrics
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_usage_metrics_updated_at'
  ) THEN
    CREATE TRIGGER trg_usage_metrics_updated_at
    BEFORE UPDATE ON usage_metrics
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;

  -- api_keys
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_api_keys_updated_at'
  ) THEN
    CREATE TRIGGER trg_api_keys_updated_at
    BEFORE UPDATE ON api_keys
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- ===========================================================================
-- 12. COMENTARIOS DE DOCUMENTACIÓN
-- ===========================================================================
COMMENT ON TABLE subscriptions IS 'Suscripciones SaaS por tenant (business_profile)';
COMMENT ON TABLE invoices IS 'Facturas emitidas a tenants (append-only, inmutables tras emisión)';
COMMENT ON TABLE webhook_events IS 'Log de webhooks procesados para idempotencia (Stripe/Wompi)';
COMMENT ON TABLE usage_metrics IS 'Contadores de uso por tenant + feature + período mensual';
COMMENT ON TABLE api_keys IS 'API keys tenant-scoped para integraciones externas';
COMMENT ON TABLE audit_logs IS 'Log de auditoría de acciones administrativas y automáticas';

COMMENT ON COLUMN subscriptions.tenant_id IS 'FK a business_profiles(id) - VARCHAR(36)';
COMMENT ON COLUMN invoices.tenant_id IS 'FK a business_profiles(id) - VARCHAR(36)';
COMMENT ON COLUMN usage_metrics.tenant_id IS 'FK a business_profiles(id) - VARCHAR(36)';
COMMENT ON COLUMN api_keys.tenant_id IS 'FK a business_profiles(id) - VARCHAR(36)';
COMMENT ON COLUMN audit_logs.target_id IS 'ID del objetivo: tenant_id (VARCHAR(36)) o user_id (INTEGER::text)';
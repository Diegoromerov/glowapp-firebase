-- ===========================================================================
-- 109_saas_tenant_plan.sql — Columna saas_plan en business_profiles
-- ===========================================================================
-- Idempotente: todo es ALTER TABLE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
-- Ejecutar DESPUÉS de 012_business_engine.sql y 107_saas_billing_schema.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Añadir columna saas_plan a business_profiles
-- ---------------------------------------------------------------------------
ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS saas_plan VARCHAR(50) DEFAULT 'FREE_TRIAL'
CHECK (saas_plan IN ('FREE_TRIAL','FREEMIUM','BASIC','PRO','ENTERPRISE'));

-- ---------------------------------------------------------------------------
-- 2. Añadir columnas de facturación complementarias
-- ---------------------------------------------------------------------------
ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS billing_email VARCHAR(255),
ADD COLUMN IF NOT EXISTS billing_name VARCHAR(200),
ADD COLUMN IF NOT EXISTS billing_tax_id VARCHAR(50),
ADD COLUMN IF NOT EXISTS billing_address JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255) UNIQUE,
ADD COLUMN IF NOT EXISTS wompi_customer_id VARCHAR(255) UNIQUE;

-- ---------------------------------------------------------------------------
-- 3. Índices para queries frecuentes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_business_profiles_saas_plan ON business_profiles(saas_plan);
CREATE INDEX IF NOT EXISTS idx_business_profiles_stripe_customer ON business_profiles(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_business_profiles_wompi_customer ON business_profiles(wompi_customer_id);

-- ---------------------------------------------------------------------------
-- 4. Comentario de documentación
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN business_profiles.saas_plan IS 'Plan SaaS actual del tenant: FREE_TRIAL, FREEMIUM, BASIC, PRO, ENTERPRISE';
COMMENT ON COLUMN business_profiles.stripe_customer_id IS 'ID de cliente en Stripe para pagos internacionales (USD)';
COMMENT ON COLUMN business_profiles.wompi_customer_id IS 'ID de cliente en Wompi para pagos Colombia (COP)';
-- 161_create_carrier_accounts.sql
-- Migración F1-Logística: Tabla de cuentas de transportadoras (Envíame + carriers directos)

CREATE TABLE IF NOT EXISTS carrier_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  
  -- Identificación de la cuenta
  carrier VARCHAR(50) NOT NULL,                    -- 'envia', 'inter', 'coordinadora', 'servientrega', 'tcc', 'envia_472'
  account_name VARCHAR(100) NOT NULL,              -- Nombre interno: 'GlowApp Principal', 'Proveedor Pilot', etc.
  account_id_external VARCHAR(100) NOT NULL,       -- ID de cuenta en Envíame/carrier (ej: 'envia_abc123')
  
  -- Credenciales (cifradas con ENCRYPTION_KEY)
  api_key_encrypted TEXT NOT NULL,
  api_secret_encrypted TEXT,
  webhook_secret_encrypted TEXT,
  
  -- Configuración operativa
  is_default BOOLEAN NOT NULL DEFAULT FALSE,       -- Una por tenant + carrier
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  modo_prueba BOOLEAN NOT NULL DEFAULT TRUE,       -- true = sandbox, false = producción
  
  -- Metadatos
  descripcion TEXT,
  creado_por INTEGER REFERENCES usuarios(id),
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

-- Restricción: una cuenta default por tenant + carrier
CREATE UNIQUE INDEX IF NOT EXISTS uq_carrier_accounts_tenant_carrier_default
  ON carrier_accounts(tenant_id, carrier)
  WHERE is_default = TRUE AND activo = TRUE;

-- Índices
CREATE INDEX IF NOT EXISTS idx_carrier_accounts_tenant ON carrier_accounts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_carrier_accounts_carrier ON carrier_accounts(carrier);
CREATE INDEX IF NOT EXISTS idx_carrier_accounts_activo ON carrier_accounts(activo) WHERE activo = TRUE;

-- Trigger para actualizado_en
CREATE OR REPLACE FUNCTION update_carrier_accounts_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trigger_carrier_accounts_updated_at ON carrier_accounts;
CREATE TRIGGER trigger_carrier_accounts_updated_at
  BEFORE UPDATE ON carrier_accounts
  FOR EACH ROW EXECUTE FUNCTION update_carrier_accounts_updated_at();

-- RLS
ALTER TABLE carrier_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE carrier_accounts FORCE ROW LEVEL SECURITY;

-- Políticas: solo admin y sistema pueden leer/escribir
CREATE POLICY carrier_accounts_admin_all ON carrier_accounts
  FOR ALL TO app_rls_user
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

-- Sistema (jobs, webhooks) usa tenant de plataforma
CREATE POLICY carrier_accounts_system_all ON carrier_accounts
  FOR ALL TO app_rls_user
  USING (current_setting('app.tenant_id', true) = current_setting('app.platform_tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) = current_setting('app.platform_tenant_id', true));

-- Comentarios
COMMENT ON TABLE carrier_accounts IS 'Cuentas de transportadoras (Envíame multi-carrier o directas) por tenant';
COMMENT ON COLUMN carrier_accounts.carrier IS 'Slug del carrier: envia, inter, coordinadora, servientrega, tcc, etc.';
COMMENT ON COLUMN carrier_accounts.account_id_external IS 'ID de la cuenta en la plataforma del carrier/Envíame';
COMMENT ON COLUMN carrier_accounts.modo_prueba IS 'true = sandbox/test, false = producción. Envíame usa cuentas separadas.';
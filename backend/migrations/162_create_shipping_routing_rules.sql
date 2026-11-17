-- 162_create_shipping_routing_rules.sql
-- Migración F1-Logística: Reglas de routing inteligente (carrier óptimo por zona/peso/valor)

CREATE TABLE IF NOT EXISTS shipping_routing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zona_id UUID REFERENCES zonas_envio(id) ON DELETE CASCADE,
  
  -- Carrier y servicio a usar
  carrier VARCHAR(50) NOT NULL,                    -- 'inter', 'coordinadora', 'servientrega', 'tcc', 'envia'
  carrier_service_code VARCHAR(50) NOT NULL,       -- Código de servicio en Envíame/carrier
  carrier_account_id UUID REFERENCES carrier_accounts(id),
  
  -- Prioridad (1 = preferida, 2 = fallback, etc.)
  prioridad INTEGER NOT NULL DEFAULT 1,
  
  -- Condiciones de aplicación
  peso_min_kg NUMERIC(6,2) DEFAULT 0,
  peso_max_kg NUMERIC(6,2),
  valor_min_cop NUMERIC(12,2) DEFAULT 0,
  valor_max_cop NUMERIC(12,2),
  
  -- SLA objetivo
  dias_maximos_entrega INTEGER,
  requiere_cobertura_rural BOOLEAN DEFAULT FALSE,
  
  -- Costo: si NULL, usa tarifa real del carrier; si definido, override para cálculo cliente
  tarifa_base_override NUMERIC(10,2),
  tarifa_por_kg_override NUMERIC(10,2),
  
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_shipping_rules_zona ON shipping_routing_rules(zona_id);
CREATE INDEX IF NOT EXISTS idx_shipping_rules_prioridad ON shipping_routing_rules(zona_id, prioridad) WHERE activo = TRUE;
CREATE INDEX IF NOT EXISTS idx_shipping_rules_carrier ON shipping_routing_rules(carrier);

-- Trigger actualizado_en
CREATE OR REPLACE FUNCTION update_shipping_routing_rules_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trigger_shipping_routing_rules_updated_at ON shipping_routing_rules;
CREATE TRIGGER trigger_shipping_routing_rules_updated_at
  BEFORE UPDATE ON shipping_routing_rules
  FOR EACH ROW EXECUTE FUNCTION update_shipping_routing_rules_updated_at();

-- RLS
ALTER TABLE shipping_routing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipping_routing_rules FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shipping_rules_admin_all ON shipping_routing_rules;
CREATE POLICY shipping_rules_admin_all ON shipping_routing_rules
  FOR ALL TO app_rls_user
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

DROP POLICY IF EXISTS shipping_rules_system_all ON shipping_routing_rules;
CREATE POLICY shipping_rules_system_all ON shipping_routing_rules
  FOR ALL TO app_rls_user
  USING (current_setting('app.tenant_id', true) = current_setting('app.platform_tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) = current_setting('app.platform_tenant_id', true));

-- Comentarios
COMMENT ON TABLE shipping_routing_rules IS 'Reglas de routing: qué carrier/servicio usar por zona, peso, valor y SLA';
COMMENT ON COLUMN shipping_routing_rules.carrier IS 'Slug del carrier preferido para esta regla';
COMMENT ON COLUMN shipping_routing_rules.prioridad IS '1 = primera opción, 2 = fallback, etc. El motor prueba en orden';
COMMENT ON COLUMN shipping_routing_rules.tarifa_base_override IS 'Si definido, usa esta tarifa base en vez de la del carrier para cotizar al cliente';
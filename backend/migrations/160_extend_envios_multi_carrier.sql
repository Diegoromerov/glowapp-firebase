-- 160_extend_envios_multi_carrier.sql
-- Migración F1-Logística: Extender tabla envios para multi-carrier + etiquetas + recolección + dirección origen

-- 1. Campos de multi-carrier y etiquetas
ALTER TABLE envios
  ADD COLUMN IF NOT EXISTS label_pdf_url TEXT,
  ADD COLUMN IF NOT EXISTS label_zpl TEXT,
  ADD COLUMN IF NOT EXISTS carrier_service_code VARCHAR(50),  -- ej: 'inter_express', 'coord_paq', 'servi_estandar'
  ADD COLUMN IF NOT EXISTS carrier_account_id UUID REFERENCES carrier_accounts(id);

-- 2. Campos de recolección (pickup)
ALTER TABLE envios
  ADD COLUMN IF NOT EXISTS pickup_scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pickup_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pickup_id VARCHAR(100),           -- ID de recolección en Envíame/carrier
  ADD COLUMN IF NOT EXISTS pickup_window_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pickup_window_end TIMESTAMPTZ;

-- 3. Dirección de origen estructurada (formato colombiano) - obligatoria para carriers
ALTER TABLE envios
  ADD COLUMN IF NOT EXISTS origen_tipo_via VARCHAR(30),
  ADD COLUMN IF NOT EXISTS origen_numero_principal VARCHAR(10),
  ADD COLUMN IF NOT EXISTS origen_letra_principal VARCHAR(5),
  ADD COLUMN IF NOT EXISTS origen_numero_secundario VARCHAR(10),
  ADD COLUMN IF NOT EXISTS origen_letra_secundaria VARCHAR(5),
  ADD COLUMN IF NOT EXISTS origen_complemento VARCHAR(100),
  ADD COLUMN IF NOT EXISTS origen_barrio VARCHAR(150),
  ADD COLUMN IF NOT EXISTS origen_ciudad VARCHAR(100) NOT NULL DEFAULT 'Bogotá',
  ADD COLUMN IF NOT EXISTS origen_departamento VARCHAR(100) NOT NULL DEFAULT 'Cundinamarca',
  ADD COLUMN IF NOT EXISTS origen_codigo_postal VARCHAR(10),
  ADD COLUMN IF NOT EXISTS origen_dane_code VARCHAR(5);       -- Código DANE municipio (5 dígitos), obligatorio para carriers CO

-- 4. Índices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_envios_carrier_service ON envios(carrier_service_code);
CREATE INDEX IF NOT EXISTS idx_envios_carrier_account ON envios(carrier_account_id);
CREATE INDEX IF NOT EXISTS idx_envios_pickup_scheduled ON envios(pickup_scheduled_at) WHERE pickup_scheduled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_envios_origen_ciudad_depto ON envios(origen_ciudad, origen_departamento);

-- 5. Comentarios
COMMENT ON COLUMN envios.label_pdf_url IS 'URL pública del PDF de la etiqueta de envío (generada por Envíame)';
COMMENT ON COLUMN envios.label_zpl IS 'Etiqueta en formato ZPL para impresoras térmicas';
COMMENT ON COLUMN envios.carrier_service_code IS 'Código de servicio del carrier (ej: inter_express, coord_paq, servi_estandar)';
COMMENT ON COLUMN envios.carrier_account_id IS 'FK a carrier_accounts: cuenta usada para generar esta etiqueta';
COMMENT ON COLUMN envios.pickup_scheduled_at IS 'Fecha/hora programada para recolección por el carrier';
COMMENT ON COLUMN envios.pickup_confirmed_at IS 'Fecha/hora en que el carrier confirmó la recolección';
COMMENT ON COLUMN envios.pickup_id IS 'ID de recolección en Envíame/carrier para tracking';
COMMENT ON COLUMN envios.origen_dane_code IS 'Código DANE del municipio de origen (5 dígitos), obligatorio para carriers colombianos';
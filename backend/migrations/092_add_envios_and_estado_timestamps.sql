-- 092_add_envios_and_estado_timestamps.sql
-- Migración L2/L3: tabla de envíos + timestamps de estado en pedidos_tienda

-- Añadir timestamps de transición de estado a pedidos_tienda
ALTER TABLE pedidos_tienda
  ADD COLUMN IF NOT EXISTS pagado_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS despachado_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS entregado_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelado_en TIMESTAMPTZ;

-- Crear tabla de envíos (tracking real)
CREATE TABLE IF NOT EXISTS envios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id UUID NOT NULL REFERENCES pedidos_tienda(id) ON DELETE CASCADE,
  transportadora VARCHAR(100) NOT NULL,            -- ej: 'Inter Rapidísimo', 'Servientrega', 'Coordinadora'
  guia VARCHAR(100) NOT NULL,                      -- número de guía/rastreo
  url_rastreo TEXT,                                -- URL pública de tracking
  estado VARCHAR(30) DEFAULT 'CREADO' CHECK (estado IN ('CREADO', 'RECOGIDO', 'EN_TRANSITO', 'EN_CENTRO_DESTINO', 'SALIDA_ENTREGA', 'ENTREGADO', 'FALLIDO', 'DEVUELTO')),
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ DEFAULT NOW(),
  entregado_en TIMESTAMPTZ,
  observaciones TEXT
);

CREATE INDEX IF NOT EXISTS idx_envios_pedido ON envios(pedido_id);
CREATE INDEX IF NOT EXISTS idx_envios_guia ON envios(guia);

-- Trigger para actualizar actualizado_en
CREATE OR REPLACE FUNCTION update_envios_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizado_en = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_envios_updated_at ON envios;
CREATE TRIGGER trigger_envios_updated_at
  BEFORE UPDATE ON envios
  FOR EACH ROW
  EXECUTE FUNCTION update_envios_updated_at();
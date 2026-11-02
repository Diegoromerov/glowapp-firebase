-- Migración 091: Agregar campos de factura electrónica a bookings y pedidos_tienda
-- CUFE (Código Único de Factura Electrónica) y QR para trazabilidad DIAN

-- Tabla bookings (citas)
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS cufe VARCHAR(96),
  ADD COLUMN IF NOT EXISTS qr_factura TEXT,
  ADD COLUMN IF NOT EXISTS factura_emitida BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS factura_fecha TIMESTAMPTZ;

COMMENT ON COLUMN bookings.cufe IS 'Código Único de Factura Electrónica DIAN (SHA-384 hex, 96 chars)';
COMMENT ON COLUMN bookings.qr_factura IS 'Código QR de la factura electrónica (base64 o URL)';
COMMENT ON COLUMN bookings.factura_emitida IS 'Indica si la factura fue emitida y aceptada por DIAN';
COMMENT ON COLUMN bookings.factura_fecha IS 'Fecha y hora de emisión de la factura electrónica';

-- Tabla pedidos_tienda (GlowStore)
ALTER TABLE pedidos_tienda
  ADD COLUMN IF NOT EXISTS cufe VARCHAR(96),
  ADD COLUMN IF NOT EXISTS qr_factura TEXT,
  ADD COLUMN IF NOT EXISTS factura_emitida BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS factura_fecha TIMESTAMPTZ;

COMMENT ON COLUMN pedidos_tienda.cufe IS 'Código Único de Factura Electrónica DIAN (SHA-384 hex, 96 chars)';
COMMENT ON COLUMN pedidos_tienda.qr_factura IS 'Código QR de la factura electrónica (base64 o URL)';
COMMENT ON COLUMN pedidos_tienda.factura_emitida IS 'Indica si la factura fue emitida y aceptada por DIAN';
COMMENT ON COLUMN pedidos_tienda.factura_fecha IS 'Fecha y hora de emisión de la factura electrónica';

-- Índices para búsquedas rápidas por CUFE
CREATE INDEX IF NOT EXISTS idx_bookings_cufe ON bookings(cufe);
CREATE INDEX IF NOT EXISTS idx_pedidos_tienda_cufe ON pedidos_tienda(cufe);
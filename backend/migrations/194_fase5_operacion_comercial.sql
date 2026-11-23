-- Fase 5: idempotencia de operaciones de caja/inventario y recetas por servicio.
-- Aditiva: no modifica saldos ni movimientos históricos.

BEGIN;

ALTER TABLE caja_movimientos
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(100),
  ADD COLUMN IF NOT EXISTS request_hash CHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_caja_idempotency
  ON caja_movimientos (tenant_id, salon_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE inventario_movimientos
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(100),
  ADD COLUMN IF NOT EXISTS request_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS booking_id UUID REFERENCES bookings(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventario_movimiento_idempotency
  ON inventario_movimientos (tenant_id, salon_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventario_mov_booking
  ON inventario_movimientos (tenant_id, salon_id, booking_id)
  WHERE booking_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS salon_servicio_insumos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  salon_id INTEGER NOT NULL,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES inventario_salon(id) ON DELETE RESTRICT,
  cantidad NUMERIC(12, 3) NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_por INTEGER NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT salon_servicio_insumo_cantidad_positiva CHECK (cantidad > 0),
  CONSTRAINT salon_servicio_insumo_unico UNIQUE (salon_id, service_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_salon_servicio_insumos_service
  ON salon_servicio_insumos (tenant_id, salon_id, service_id)
  WHERE activo = TRUE;

CREATE TABLE IF NOT EXISTS inventario_consumos_reserva (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  salon_id INTEGER NOT NULL,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  item_id UUID NOT NULL REFERENCES inventario_salon(id) ON DELETE RESTRICT,
  cantidad_solicitada NUMERIC(12, 3) NOT NULL,
  cantidad_consumida NUMERIC(12, 3) NOT NULL,
  faltante NUMERIC(12, 3) NOT NULL DEFAULT 0,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventario_consumo_cantidades_validas CHECK (
    cantidad_solicitada > 0 AND cantidad_consumida >= 0 AND faltante >= 0
    AND cantidad_solicitada = cantidad_consumida + faltante
  ),
  CONSTRAINT inventario_consumo_reserva_unico UNIQUE (booking_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_inventario_consumos_salon_fecha
  ON inventario_consumos_reserva (tenant_id, salon_id, creado_en DESC);

ALTER TABLE inventario_consumos_reserva ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventario_consumos_reserva FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relname = 'inventario_consumos_reserva'
  ) THEN
    CREATE POLICY tenant_isolation_inventario_consumos_reserva ON inventario_consumos_reserva
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMENT ON TABLE inventario_consumos_reserva IS
  'Consumo estimado de insumos por reserva finalizada; conserva cantidades solicitadas, atendidas y faltantes.';

ALTER TABLE salon_servicio_insumos ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_servicio_insumos FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relname = 'salon_servicio_insumos'
  ) THEN
    CREATE POLICY tenant_isolation_salon_servicio_insumos ON salon_servicio_insumos
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;

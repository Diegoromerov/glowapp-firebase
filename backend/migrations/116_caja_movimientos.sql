-- 116_caja_movimientos.sql
-- E-05 (D-GL-027) — Caja del salón: ingresos, gastos y constancias de pago.
--
-- QUÉ NO ES: no es facturación electrónica. El plan del Director dice
-- «solo constancias de pago»; por eso `constancia_ref` es un número propio del
-- salón y no hay integración con DIAN ni con numeración fiscal.
--
-- El dinero no se recalcula en el cliente: todo importe vive aquí con su tipo,
-- concepto y método. Los KPIs son agregados de esta tabla, nunca de memoria.
--
-- `persona_id` es a quién se le atribuye el movimiento (quién prestó el servicio
-- o quién recibió el pago). Es lo que permite que un `MEMBER` vea únicamente lo
-- suyo sin abrir la caja completa del salón.

BEGIN;

CREATE TABLE IF NOT EXISTS caja_movimientos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        VARCHAR(36) NOT NULL,
  salon_id         INTEGER NOT NULL,
  tipo             VARCHAR(10) NOT NULL,
  concepto         VARCHAR(32) NOT NULL,
  descripcion      TEXT,
  monto            NUMERIC(12, 2) NOT NULL,
  moneda           CHAR(3) NOT NULL DEFAULT 'COP',
  metodo_pago      VARCHAR(16) NOT NULL DEFAULT 'EFECTIVO',
  persona_id       INTEGER,
  booking_id       UUID REFERENCES bookings(id) ON DELETE SET NULL,
  constancia_ref   VARCHAR(40) NOT NULL,
  registrado_por   INTEGER NOT NULL,
  fecha_movimiento TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT caja_tipo_valido CHECK (tipo IN ('INGRESO', 'GASTO')),
  CONSTRAINT caja_concepto_valido CHECK (concepto IN (
    'SERVICIO', 'PRODUCTO', 'PROPINA', 'ALQUILER', 'COMISION',
    'INSUMO', 'NOMINA', 'OTRO'
  )),
  CONSTRAINT caja_metodo_valido CHECK (metodo_pago IN (
    'EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'NEQUI', 'DAVIPLATA', 'OTRO'
  )),
  CONSTRAINT caja_monto_positivo CHECK (monto > 0)
);

-- La consulta caliente es «movimientos del salón en un rango de fechas».
CREATE INDEX IF NOT EXISTS idx_caja_salon_fecha
  ON caja_movimientos (tenant_id, salon_id, fecha_movimiento DESC);

-- La consulta del colaborador es «lo mío».
CREATE INDEX IF NOT EXISTS idx_caja_persona
  ON caja_movimientos (tenant_id, salon_id, persona_id, fecha_movimiento DESC);

-- Una constancia no se emite dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS uq_caja_constancia
  ON caja_movimientos (tenant_id, constancia_ref);

-- Aislamiento por inquilino, coherente con las tablas `business_*` (migración 115).
ALTER TABLE caja_movimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE caja_movimientos FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relname = 'caja_movimientos'
  ) THEN
    CREATE POLICY tenant_isolation_caja_movimientos ON caja_movimientos
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;

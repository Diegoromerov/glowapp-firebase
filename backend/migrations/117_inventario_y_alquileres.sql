-- 117_inventario_y_alquileres.sql
-- E-06 (D-GL-027) — Inventario operable y recursos alquilables del salón.
--
-- QUÉ ES: el stock que el salón usa para operar (insumos y producto) con su
-- historial de entradas y salidas, y los puestos/sillas/mesas que el salón
-- alquila a sus profesionales con su canon.
--
-- QUÉ NO ES: no es el inventario en consignación del marketplace
-- (`inventario_consignacion_prestador`, que ya existía y es otra cosa: producto
-- de un prestador que se vende al cliente final).
--
-- El stock se guarda como saldo (`stock_actual`) y **cada cambio deja un
-- movimiento**. Sin el movimiento no hay forma de explicar por qué el saldo es
-- el que es, y el salón perdería la única auditoría que tiene.

BEGIN;

-- ── Inventario del salón ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inventario_salon (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         VARCHAR(36) NOT NULL,
  salon_id          INTEGER NOT NULL,
  nombre            VARCHAR(120) NOT NULL,
  categoria         VARCHAR(32) NOT NULL DEFAULT 'INSUMO',
  unidad            VARCHAR(16) NOT NULL DEFAULT 'UNIDAD',
  stock_actual      NUMERIC(12, 2) NOT NULL DEFAULT 0,
  stock_minimo      NUMERIC(12, 2) NOT NULL DEFAULT 0,
  costo_unitario    NUMERIC(12, 2),
  proveedor         VARCHAR(120),
  activo            BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventario_categoria_valida CHECK (categoria IN (
    'INSUMO', 'PRODUCTO', 'HERRAMIENTA', 'OTRO'
  )),
  CONSTRAINT inventario_stock_no_negativo CHECK (stock_actual >= 0),
  CONSTRAINT inventario_minimo_no_negativo CHECK (stock_minimo >= 0)
);

-- Un insumo no se duplica por salón (sin distinguir mayúsculas).
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventario_nombre
  ON inventario_salon (tenant_id, salon_id, lower(nombre));

CREATE TABLE IF NOT EXISTS inventario_movimientos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      VARCHAR(36) NOT NULL,
  salon_id       INTEGER NOT NULL,
  item_id        UUID NOT NULL REFERENCES inventario_salon(id) ON DELETE CASCADE,
  tipo           VARCHAR(10) NOT NULL,
  cantidad       NUMERIC(12, 2) NOT NULL,
  motivo         VARCHAR(160),
  registrado_por INTEGER NOT NULL,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventario_mov_tipo_valido CHECK (tipo IN ('ENTRADA', 'SALIDA', 'AJUSTE')),
  CONSTRAINT inventario_mov_cantidad_positiva CHECK (cantidad > 0)
);

CREATE INDEX IF NOT EXISTS idx_inventario_mov_item
  ON inventario_movimientos (tenant_id, salon_id, item_id, creado_en DESC);

-- ── Recursos alquilables (sillas, mesas, puestos) ───────────────────────────

CREATE TABLE IF NOT EXISTS recursos_alquilables (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      VARCHAR(36) NOT NULL,
  salon_id       INTEGER NOT NULL,
  nombre         VARCHAR(80) NOT NULL,
  tipo           VARCHAR(16) NOT NULL DEFAULT 'PUESTO',
  canon_mensual  NUMERIC(12, 2) NOT NULL DEFAULT 0,
  estado         VARCHAR(16) NOT NULL DEFAULT 'DISPONIBLE',
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT recurso_tipo_valido CHECK (tipo IN (
    'SILLA', 'MESA', 'PUESTO', 'CABINA', 'OTRO'
  )),
  CONSTRAINT recurso_estado_valido CHECK (estado IN (
    'DISPONIBLE', 'OCUPADO', 'INACTIVO'
  )),
  CONSTRAINT recurso_canon_no_negativo CHECK (canon_mensual >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_recurso_nombre
  ON recursos_alquilables (tenant_id, salon_id, lower(nombre));

CREATE TABLE IF NOT EXISTS alquileres (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      VARCHAR(36) NOT NULL,
  salon_id       INTEGER NOT NULL,
  recurso_id     UUID NOT NULL REFERENCES recursos_alquilables(id) ON DELETE RESTRICT,
  persona_id     INTEGER NOT NULL,
  canon_mensual  NUMERIC(12, 2) NOT NULL DEFAULT 0,
  periodo_inicio DATE NOT NULL DEFAULT CURRENT_DATE,
  periodo_fin    DATE,
  estado         VARCHAR(16) NOT NULL DEFAULT 'ACTIVO',
  creado_por     INTEGER NOT NULL,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT alquiler_estado_valido CHECK (estado IN ('ACTIVO', 'FINALIZADO')),
  CONSTRAINT alquiler_canon_no_negativo CHECK (canon_mensual >= 0),
  CONSTRAINT alquiler_periodo_coherente CHECK (
    periodo_fin IS NULL OR periodo_fin >= periodo_inicio
  )
);

-- Un recurso no puede estar alquilado dos veces a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS uq_alquiler_recurso_activo
  ON alquileres (recurso_id) WHERE estado = 'ACTIVO';

CREATE INDEX IF NOT EXISTS idx_alquiler_persona
  ON alquileres (tenant_id, salon_id, persona_id, estado);

-- ── Aislamiento por inquilino ───────────────────────────────────────────────

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'inventario_salon', 'inventario_movimientos',
    'recursos_alquilables', 'alquileres'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
       WHERE c.relname = t
    ) THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation_%s ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
        t, t
      );
    END IF;
  END LOOP;
END $$;

COMMIT;

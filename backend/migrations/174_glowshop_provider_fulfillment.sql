-- 174_glowshop_provider_fulfillment.sql
-- Bind each parcel to its dispatching provider and persist preparation state.
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS proveedor_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_productos_proveedor_id
  ON productos(proveedor_id) WHERE proveedor_id IS NOT NULL;

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS direccion_tipo_via VARCHAR(30),
  ADD COLUMN IF NOT EXISTS direccion_numero_principal VARCHAR(10),
  ADD COLUMN IF NOT EXISTS direccion_letra_principal VARCHAR(5),
  ADD COLUMN IF NOT EXISTS direccion_numero_secundario VARCHAR(10),
  ADD COLUMN IF NOT EXISTS direccion_letra_secundaria VARCHAR(5),
  ADD COLUMN IF NOT EXISTS direccion_complemento VARCHAR(100),
  ADD COLUMN IF NOT EXISTS direccion_barrio VARCHAR(150),
  ADD COLUMN IF NOT EXISTS direccion_ciudad VARCHAR(100),
  ADD COLUMN IF NOT EXISTS direccion_departamento VARCHAR(100),
  ADD COLUMN IF NOT EXISTS direccion_codigo_postal VARCHAR(10),
  ADD COLUMN IF NOT EXISTS direccion_dane_code VARCHAR(5);

-- Crear un perfil mínimo solo para proveedores que aún no tengan uno. El id
-- del esquema original es VARCHAR(36); se conserva el perfil completo cuando ya existe.
ALTER TABLE envios ALTER COLUMN guia DROP NOT NULL;
ALTER TABLE envios
  ADD COLUMN IF NOT EXISTS destino_ciudad VARCHAR(100),
  ADD COLUMN IF NOT EXISTS destino_departamento VARCHAR(100),
  ADD COLUMN IF NOT EXISTS destino_codigo_postal VARCHAR(10),
  ADD COLUMN IF NOT EXISTS prestador_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS preparacion_estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
  ADD COLUMN IF NOT EXISTS items_preparados JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS preparado_en TIMESTAMPTZ;

ALTER TABLE envios DROP CONSTRAINT IF EXISTS envios_preparacion_estado_check;
ALTER TABLE envios ADD CONSTRAINT envios_preparacion_estado_check
  CHECK (preparacion_estado IN ('PENDIENTE', 'PREPARADO'));

CREATE INDEX IF NOT EXISTS idx_envios_prestador_estado
  ON envios(prestador_id, estado) WHERE prestador_id IS NOT NULL;

-- Recover the owner for existing single-provider shipments. Multi-provider legacy
-- orders stay unassigned and must be reconciled before the provider can dispatch.
WITH unicos AS (
  SELECT dpt.pedido_id, MIN(p.proveedor_id) AS prestador_id
    FROM detalles_pedido_tienda dpt
    JOIN productos p ON p.id = dpt.producto_id
   WHERE p.proveedor_id IS NOT NULL
   GROUP BY dpt.pedido_id
  HAVING COUNT(DISTINCT p.proveedor_id) = 1
)
UPDATE envios e SET prestador_id = u.prestador_id
  FROM unicos u
 WHERE e.pedido_id = u.pedido_id AND e.prestador_id IS NULL;

-- ============================================================================
-- Migración 122: columnas de costo y SKU en el catálogo
-- ============================================================================
-- POR QUÉ EXISTE
--   La 071 (GlowShop) añade `productos.costo` y `productos.sku`, y el código ya
--   las usa: `createProduct` y `updateProduct` las exigen (L21: no se puede
--   vender sin conocer el costo). Como la 071 nunca se aplicó, esas columnas no
--   existen y cualquier alta o edición desde el panel responde 500 con
--   `column "costo" of relation "productos" does not exist`.
--
--   Leer el catálogo funciona; gestionarlo, no. Esta migración cierra esa
--   asimetría sin arrastrar el resto de la 071.
--
-- LO QUE HACE
--   1. `productos.costo NUMERIC(10,2)`, nullable: los productos existentes no
--      tienen costo y no se inventa (ley de conservación de datos). La API lo
--      exige en el alta.
--   2. `productos.sku VARCHAR(40)`, nullable.
--   3. Restricción `productos_costo_no_negativo`.
--
-- LO QUE NO HACE
--   - No rellena costos ni borra nada.
--   - No toca `precios_producto` (eso ya lo hizo la 121).
--
-- IDEMPOTENCIA
--   IF NOT EXISTS en todo. Se reejecuta en cada arranque sin efecto.
-- ============================================================================

BEGIN;

ALTER TABLE productos ADD COLUMN IF NOT EXISTS costo NUMERIC(10,2);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS sku   VARCHAR(40);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'productos_costo_no_negativo'
      AND conrelid = 'productos'::regclass
  ) THEN
    ALTER TABLE productos
      ADD CONSTRAINT productos_costo_no_negativo CHECK (costo IS NULL OR costo >= 0);
  END IF;
END $$;

-- Autoverificación
DO $$
DECLARE
  v_costo boolean;
  v_sku   boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'productos' AND column_name = 'costo'
  ) INTO v_costo;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'productos' AND column_name = 'sku'
  ) INTO v_sku;

  IF NOT (v_costo AND v_sku) THEN
    RAISE EXCEPTION '122: faltan columnas (costo=%, sku=%)', v_costo, v_sku;
  END IF;

  RAISE NOTICE '122: productos.costo y productos.sku aseguradas';
END $$;

COMMIT;

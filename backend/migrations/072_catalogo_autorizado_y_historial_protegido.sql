-- ============================================================================
-- Migración 072: GlowShop A0 — catálogo autorizado y protección de historial
-- ============================================================================
-- QUÉ HACE (y por qué así)
--   1. Permite valores NULL en la columna deprecada `productos.precio`.
--      En el esquema original la columna era NOT NULL sin DEFAULT. Con el modelo
--      nuevo de precios (`precios_producto`), la columna `precio` está deprecada
--      y su restricción NOT NULL impedía la creación de nuevos productos.
--   2. Recrea las claves foráneas de `precios_historial` (`producto_id` y `lista_id`)
--      con `ON DELETE RESTRICT` (en lugar de CASCADE).
--      Con esto se evita que la eliminación de un producto borre su historial de
--      cambios de precios (Lineamiento L22: conservación de datos de auditoría).
--
-- LO QUE NO HACE
--   - No modifica `precios_producto` (mantiene CASCADE, ya que el precio activo
--     de un producto eliminado no requiere conservarse).
--   - No elimina la columna `precio` ni borra datos existentes.
--
-- SEGURIDAD E IDEMPOTENCIA
--   La migración es completamente idempotente y concluye con un bloque de
--   verificación asertiva PL/pgSQL que falla en voz alta si la estructura final
--   no cumple las restricciones exigidas.
-- ============================================================================

-- 1. Desactivar NOT NULL en columna deprecada productos.precio
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'productos' AND column_name = 'precio' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE productos ALTER COLUMN precio DROP NOT NULL;
  END IF;
END $$;

-- 2. Actualizar Foreign Keys de precios_historial a ON DELETE RESTRICT
DO $$
BEGIN
  -- Eliminar claves foráneas previas si existen
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_precios_historial_producto') THEN
    ALTER TABLE precios_historial DROP CONSTRAINT fk_precios_historial_producto;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'precios_historial_producto_id_fkey') THEN
    ALTER TABLE precios_historial DROP CONSTRAINT precios_historial_producto_id_fkey;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_precios_historial_lista') THEN
    ALTER TABLE precios_historial DROP CONSTRAINT fk_precios_historial_lista;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'precios_historial_lista_id_fkey') THEN
    ALTER TABLE precios_historial DROP CONSTRAINT precios_historial_lista_id_fkey;
  END IF;
END $$;

-- Crear claves foráneas con ON DELETE RESTRICT
-- Envuelto en DO: `ADD CONSTRAINT` no admite IF NOT EXISTS y sin esta guarda la
-- migración fallaba al reejecutarse ("constraint already exists"), cosa que pasa
-- en cada deploy porque prepareRlsDatabase aplica la lista completa.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'precios_historial'
      AND constraint_name = 'fk_precios_historial_producto'
  ) THEN
    ALTER TABLE precios_historial
      ADD CONSTRAINT fk_precios_historial_producto
      FOREIGN KEY (producto_id) REFERENCES productos(id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'precios_historial'
      AND constraint_name = 'fk_precios_historial_lista'
  ) THEN
    ALTER TABLE precios_historial
      ADD CONSTRAINT fk_precios_historial_lista
      FOREIGN KEY (lista_id) REFERENCES listas_precios(id)
      ON DELETE RESTRICT;
  END IF;
END $$;


-- 3. Autoverificación de la migración
DO $$
DECLARE
  v_nullable text;
  v_del_rule_prod text;
  v_del_rule_lista text;
BEGIN
  -- Verificar nullable en productos.precio
  SELECT is_nullable INTO v_nullable
  FROM information_schema.columns
  WHERE table_name = 'productos' AND column_name = 'precio';

  IF v_nullable <> 'YES' THEN
    RAISE EXCEPTION 'Verificación fallida: la columna productos.precio sigue siendo NOT NULL';
  END IF;

  -- Verificar ON DELETE RESTRICT en fk_precios_historial_producto
  SELECT delete_rule INTO v_del_rule_prod
  FROM information_schema.referential_constraints rc
  JOIN information_schema.table_constraints tc ON tc.constraint_name = rc.constraint_name
  WHERE tc.table_name = 'precios_historial' AND rc.constraint_name = 'fk_precios_historial_producto';

  IF v_del_rule_prod <> 'RESTRICT' THEN
    RAISE EXCEPTION 'Verificación fallida: fk_precios_historial_producto no es RESTRICT (encontrado: %)', v_del_rule_prod;
  END IF;

  -- Verificar ON DELETE RESTRICT en fk_precios_historial_lista
  SELECT delete_rule INTO v_del_rule_lista
  FROM information_schema.referential_constraints rc
  JOIN information_schema.table_constraints tc ON tc.constraint_name = rc.constraint_name
  WHERE tc.table_name = 'precios_historial' AND rc.constraint_name = 'fk_precios_historial_lista';

  IF v_del_rule_lista <> 'RESTRICT' THEN
    RAISE EXCEPTION 'Verificación fallida: fk_precios_historial_lista no es RESTRICT (encontrado: %)', v_del_rule_lista;
  END IF;

  RAISE NOTICE '🎉 Migración 072 autoverificada exitosamente.';
END $$;

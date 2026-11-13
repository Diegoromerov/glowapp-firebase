-- 148_productos_sin_tenant.sql
--
-- Por qué el checkout decía «Producto con ID 3 no encontrado».
--
-- `productos` tiene `tenant_id` desde la 057 y FORCE ROW LEVEL SECURITY desde la
-- 068, con la política `tenant_id = app_current_tenant_id() OR tenant_id =
-- app_platform_tenant_id()`. Una fila con `tenant_id NULL` no cumple NINGUNA de
-- las dos ramas (NULL no es igual a nada), así que es invisible para el rol de
-- runtime `app_rls_user` — que es justo el que usa el checkout.
--
-- `GET /api/products` sí las muestra porque consulta como sistema (BYPASSRLS),
-- y de ahí la contradicción: el catálogo las lista y el pedido no las encuentra.
--
-- Idempotente: sólo toca las filas que siguen sin inquilino.

-- La función vive en la 071 y en la 123. En una base nueva la crea la 123, pero
-- que este archivo dependa del orden de la lista es frágil: si corre antes (o en
-- un esquema donde la función no quedó), el arranque muere con «function
-- app_platform_tenant_id() does not exist» — es lo que tenía el CI en rojo.
-- Se define aquí también, idempotente, para que el archivo se baste solo.
CREATE OR REPLACE FUNCTION app_platform_tenant_id() RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT id FROM tenants WHERE es_plataforma ORDER BY id LIMIT 1
$$;

UPDATE productos
   SET tenant_id = COALESCE(app_platform_tenant_id(), (SELECT id FROM tenants ORDER BY id LIMIT 1))
 WHERE tenant_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'productos_tenant_obligatorio'
       AND conrelid = 'productos'::regclass
  ) THEN
    -- Un producto sin inquilino no existe para nadie: se prohíbe a futuro.
    ALTER TABLE productos
      ADD CONSTRAINT productos_tenant_obligatorio CHECK (tenant_id IS NOT NULL) NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN productos.tenant_id IS
  'Inquilino del producto. NULL lo hace invisible bajo RLS forzada (ver 148).';

-- 147_usuarios_sin_tenant.sql
--
-- Rellena el inquilino de las cuentas creadas antes de este arreglo.
--
-- Por qué: `authMiddleware` fija el contexto RLS sólo cuando el usuario tiene
-- `tenant_id`. Un usuario con NULL navega el catálogo (esa ruta consulta como
-- sistema) pero cualquier consulta sobre una tabla con RLS le devuelve 0 filas:
-- el checkout respondía «Producto no encontrado» y la persona no podía comprar.
--
-- El inquilino que se asigna es el de plataforma, exactamente el mismo que ya
-- usa `createOrder` como fallback cuando el comprador no tiene uno.
--
-- Idempotente: sólo toca las filas que siguen en NULL.

-- La función vive en la 071 y en la 123. En una base nueva la crea la 123, pero
-- que este archivo dependa del orden de la lista es frágil: si corre antes (o en
-- un esquema donde la función no quedó), el arranque muere con «function
-- app_platform_tenant_id() does not exist» — es lo que tenía el CI en rojo.
-- Se define aquí también, idempotente, para que el archivo se baste solo.
CREATE OR REPLACE FUNCTION app_platform_tenant_id() RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT id FROM tenants WHERE es_plataforma ORDER BY id LIMIT 1
$$;

UPDATE usuarios
   SET tenant_id = COALESCE(app_platform_tenant_id(), (SELECT id FROM tenants ORDER BY id LIMIT 1))
 WHERE tenant_id IS NULL;

COMMENT ON COLUMN usuarios.tenant_id IS
  'Inquilino del usuario. NULL rompe RLS: toda alta debe asignar uno (ver 147).';

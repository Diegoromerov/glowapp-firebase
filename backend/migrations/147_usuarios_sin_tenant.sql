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

UPDATE usuarios
   SET tenant_id = COALESCE(app_platform_tenant_id(), (SELECT id FROM tenants ORDER BY id LIMIT 1))
 WHERE tenant_id IS NULL;

COMMENT ON COLUMN usuarios.tenant_id IS
  'Inquilino del usuario. NULL rompe RLS: toda alta debe asignar uno (ver 147).';

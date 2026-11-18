-- Las cuentas nuevas que entran con Google/Facebook se crean en un flujo de
-- sistema sin app.tenant_id. El trigger anterior solo copiaba ese contexto y
-- dejaba tenant_id NULL; luego authMiddleware no podía abrir el contexto RLS
-- y el prestador no encontraba su propia fila al enviar el RUT.
--
-- Conserva el tenant explícito o el tenant del request. Solo para usuarios
-- creados fuera de un request, asigna el tenant de plataforma. La actualización
-- repara cuentas OAuth que ya quedaron con tenant_id NULL. El backfill corre
-- en modo sistema porque usuarios tiene FORCE ROW LEVEL SECURITY.
CREATE OR REPLACE FUNCTION app_assign_tenant_id() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := app_current_tenant_id();

    IF NEW.tenant_id IS NULL
       AND TG_TABLE_SCHEMA = 'public'
       AND TG_TABLE_NAME = 'usuarios' THEN
      NEW.tenant_id := COALESCE(
        app_platform_tenant_id(),
        (SELECT id FROM public.tenants ORDER BY id LIMIT 1)
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

BEGIN;
SET LOCAL ROLE app_system;

UPDATE public.usuarios
   SET tenant_id = COALESCE(
     app_platform_tenant_id(),
     (SELECT id FROM public.tenants ORDER BY id LIMIT 1)
   )
 WHERE tenant_id IS NULL;

COMMIT;

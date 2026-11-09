-- Apply the safe cleanup from migration 057 to databases that already ran the
-- legacy 000–130 bootstrap. The startup runner intentionally does not replay
-- those migrations, so this forward migration removes only an unreferenced
-- legacy demo tenant on existing installations.
DO $$
DECLARE
  demo_tenant_id INTEGER;
  tiene_referencias BOOLEAN := FALSE;
  referencia RECORD;
BEGIN
  SELECT id INTO demo_tenant_id
    FROM public.tenants
   WHERE slug = 'demo'
   LIMIT 1;

  IF demo_tenant_id IS NULL THEN
    RAISE NOTICE '137: tenant demo no existe; sin cambios.';
    RETURN;
  END IF;

  -- Check every public tenant_id column, including legacy columns without an
  -- FK. Keep the tenant if any row still belongs to it.
  FOR referencia IN
    SELECT c.relname AS tabla
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND a.attnum > 0
       AND NOT a.attisdropped
       AND a.attname = 'tenant_id'
  LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM public.%I WHERE tenant_id::text = $1)',
      referencia.tabla
    ) INTO tiene_referencias USING demo_tenant_id::text;
    EXIT WHEN tiene_referencias;
  END LOOP;

  IF tiene_referencias THEN
    RAISE NOTICE '137: tenant demo (%) conservado porque aún tiene filas asociadas.', demo_tenant_id;
  ELSE
    DELETE FROM public.tenants
     WHERE id = demo_tenant_id
       AND slug = 'demo';
    RAISE NOTICE '137: tenant demo vacío (%) eliminado.', demo_tenant_id;
  END IF;
END $$;

-- 120: Cerrar RLS en toda tabla con tenant_id que aún no tenga política
-- Motivo: 068 fuerza RLS sobre una lista fija de tablas. Cualquier tabla con
-- tenant_id creada después (api_keys, invoices, subscriptions, usage_metrics, ...)
-- quedaba sin política y sin FORCE, y prepareRlsDatabase.js abortaba con
-- "Aislamiento incompleto". Esta migración es genérica e idempotente.
DO $$
DECLARE
  t record;
  politica text;
  expr text;
BEGIN
  FOR t IN
    SELECT c.relname AS tabla,
           coalesce((
             SELECT i.data_type
               FROM information_schema.columns i
              WHERE i.table_schema = 'public'
                AND i.table_name = c.relname
                AND i.column_name = 'tenant_id'), 'text') AS tipo
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relname <> 'spatial_ref_sys'
       AND EXISTS (
         SELECT 1 FROM information_schema.columns i
          WHERE i.table_schema = 'public'
            AND i.table_name = c.relname
            AND i.column_name = 'tenant_id')
  LOOP
    politica := 'tenant_isolation_' || t.tabla;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t.tabla);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', t.tabla);

    -- Solo se crea política donde no hay ninguna: las tablas business_* ya
    -- traen las suyas de 062 y no deben pisarse.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy p
       WHERE p.polrelid = format('public.%I', t.tabla)::regclass
    ) THEN
      IF t.tipo LIKE 'character%' OR t.tipo IN ('text', 'citext') THEN
        expr := 'tenant_id = COALESCE(NULLIF(current_setting(''app.tenant_id'', true), ''''), ''default'')';
      ELSE
        expr := 'tenant_id = COALESCE(NULLIF(current_setting(''app.tenant_id'', true), '''')::int, 0)';
      END IF;

      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL USING (%s) WITH CHECK (%s);',
        politica, t.tabla, expr, expr);
      RAISE NOTICE '120: política creada en %.', t.tabla;
    END IF;
  END LOOP;
  RAISE NOTICE '120: RLS con FORCE aplicado a todas las tablas con tenant_id.';
END $$;

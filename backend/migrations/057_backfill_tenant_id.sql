-- D-001: Backfill tenant_id for existing rows without creating demo tenants.
-- Prefer the platform tenant; older schemas fall back to the default tenant.
-- This migration is idempotent and safe to rerun during application startup.
-- Fixes the sequence for tenants table to avoid duplicate key errors due to explicit id insert in migration 055.

DO $$
DECLARE
    demo_tenant_id INTEGER;
    fallback_tenant_id INTEGER;
    tiene_referencias BOOLEAN := FALSE;
    referencia RECORD;
    hay_columna_plataforma BOOLEAN;
    t_name TEXT;
BEGIN
    -- Fix the sequence for tenants table to be based on current max id
    PERFORM setval(pg_get_serial_sequence('tenants', 'id'), COALESCE((SELECT MAX(id) FROM tenants), 0) + 1, false);

    -- New schemas designate the platform tenant in migration 071. Older
    -- schemas may not have es_plataforma yet, so check before using the column.
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'tenants'
         AND column_name = 'es_plataforma'
    ) INTO hay_columna_plataforma;
    IF hay_columna_plataforma THEN
      EXECUTE 'SELECT id FROM public.tenants WHERE es_plataforma IS TRUE ORDER BY id LIMIT 1'
        INTO fallback_tenant_id;
    END IF;
    IF fallback_tenant_id IS NULL THEN
      SELECT id INTO fallback_tenant_id FROM tenants WHERE slug = 'default' LIMIT 1;
    END IF;
    IF fallback_tenant_id IS NULL THEN
      RAISE EXCEPTION '057: no existe tenant de plataforma ni tenant default para asignar filas sin tenant_id.';
    END IF;

    -- Core tables backfill
    -- usuarios
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'usuarios') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'usuarios' AND column_name = 'tenant_id') THEN
            UPDATE usuarios SET tenant_id = fallback_tenant_id WHERE tenant_id IS NULL;
        END IF;
    END IF;

    -- servicios
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'servicios') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'servicios' AND column_name = 'tenant_id') THEN
            UPDATE servicios SET tenant_id = fallback_tenant_id WHERE tenant_id IS NULL;
        END IF;
    END IF;

    -- bookings
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bookings') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'tenant_id') THEN
            UPDATE bookings SET tenant_id = fallback_tenant_id WHERE tenant_id IS NULL;
        END IF;
    END IF;

    -- transactions
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'transactions') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'tenant_id') THEN
            UPDATE transactions SET tenant_id = fallback_tenant_id WHERE tenant_id IS NULL;
        END IF;
    END IF;

    -- reviews
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'reviews') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reviews' AND column_name = 'tenant_id') THEN
            UPDATE reviews SET tenant_id = fallback_tenant_id WHERE tenant_id IS NULL;
        END IF;
    END IF;

    -- portfolio_items
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'portfolio_items') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'portfolio_items' AND column_name = 'tenant_id') THEN
            UPDATE portfolio_items SET tenant_id = fallback_tenant_id WHERE tenant_id IS NULL;
        END IF;
    END IF;

    -- messages
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'messages') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'tenant_id') THEN
            UPDATE messages SET tenant_id = fallback_tenant_id WHERE tenant_id IS NULL;
        END IF;
    END IF;

    -- nail_tryon_jobs
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'nail_tryon_jobs') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nail_tryon_jobs' AND column_name = 'tenant_id') THEN
            UPDATE nail_tryon_jobs SET tenant_id = fallback_tenant_id WHERE tenant_id IS NULL;
        END IF;
    END IF;

    -- sos_alerts
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sos_alerts') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sos_alerts' AND column_name = 'tenant_id') THEN
            UPDATE sos_alerts SET tenant_id = fallback_tenant_id WHERE tenant_id IS NULL;
        END IF;
    END IF;

    -- user_activity_logs
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_activity_logs') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_activity_logs' AND column_name = 'tenant_id') THEN
            UPDATE user_activity_logs SET tenant_id = fallback_tenant_id WHERE tenant_id IS NULL;
        END IF;
    END IF;

    -- perfiles_prestador
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'perfiles_prestador') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'perfiles_prestador' AND column_name = 'tenant_id') THEN
            UPDATE perfiles_prestador SET tenant_id = fallback_tenant_id WHERE tenant_id IS NULL;
        END IF;
    END IF;

    -- Optional tables
    -- platform_config
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'platform_config') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'platform_config' AND column_name = 'tenant_id') THEN
            ALTER TABLE platform_config ADD COLUMN tenant_id INTEGER REFERENCES tenants(id);
        END IF;
        UPDATE platform_config SET tenant_id = fallback_tenant_id WHERE tenant_id IS NULL;
    END IF;

    -- admin_mfa
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'admin_mfa') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'admin_mfa' AND column_name = 'tenant_id') THEN
            ALTER TABLE admin_mfa ADD COLUMN tenant_id INTEGER REFERENCES tenants(id);
        END IF;
        UPDATE admin_mfa SET tenant_id = fallback_tenant_id WHERE tenant_id IS NULL;
    END IF;

    -- productos
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'productos') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'productos' AND column_name = 'tenant_id') THEN
            ALTER TABLE productos ADD COLUMN tenant_id INTEGER REFERENCES tenants(id);
        END IF;
        UPDATE productos SET tenant_id = fallback_tenant_id WHERE tenant_id IS NULL;
    END IF;

    -- beauty_knowledge_embeddings: add column if missing, leave NULL (GLOBAL RAG)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'beauty_knowledge_embeddings') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'beauty_knowledge_embeddings' AND column_name = 'tenant_id') THEN
            ALTER TABLE beauty_knowledge_embeddings ADD COLUMN tenant_id INTEGER REFERENCES tenants(id);
        END IF;
        -- Do not update; leave NULL for global data
    END IF;

    -- Drop the legacy demo tenant only when no table still stores its ID.
    -- Check every tenant_id column, including legacy columns without a foreign key.
    SELECT id INTO demo_tenant_id FROM tenants WHERE slug = 'demo' LIMIT 1;
    IF demo_tenant_id IS NOT NULL THEN
      FOR referencia IN
        SELECT c.relname AS tabla, a.attname AS columna
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_attribute a ON a.attrelid = c.oid
         WHERE n.nspname = 'public'
           AND c.relkind IN ('r', 'p')
           AND a.attnum > 0 AND NOT a.attisdropped
           AND a.attname = 'tenant_id'
      LOOP
        EXECUTE format(
          'SELECT EXISTS (SELECT 1 FROM public.%I WHERE %I::text = $1)',
          referencia.tabla, referencia.columna
        ) INTO tiene_referencias USING demo_tenant_id::text;
        EXIT WHEN tiene_referencias;
      END LOOP;

      IF NOT tiene_referencias THEN
        DELETE FROM tenants WHERE id = demo_tenant_id AND slug = 'demo';
      END IF;
    END IF;
END $$;

-- Create indexes on tenant_id for tables that exist (if not exists)
DO $$
DECLARE
    tables TEXT[] := ARRAY[
        'usuarios', 'servicios', 'bookings', 'transactions', 'reviews', 'portfolio_items', 'messages', 'nail_tryon_jobs',
        'sos_alerts', 'user_activity_logs', 'perfiles_prestador', 'platform_config', 'admin_mfa', 'productos',
        'beauty_knowledge_embeddings'
    ];
    t_name TEXT;
BEGIN
    FOREACH t_name IN ARRAY tables LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t_name) THEN
            EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_tenant_id ON %s(tenant_id);', t_name, t_name);
        END IF;
    END LOOP;
END $$;

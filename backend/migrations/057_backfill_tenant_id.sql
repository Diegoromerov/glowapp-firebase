-- D-001 Implementation: Backfill tenant_id for existing seed data - REPAIRED
-- This migration creates a default tenant for existing data and backfills tenant_id.
-- It is idempotent and safe to run multiple times.
-- It checks for table and column existence before operating.
-- Fixes the sequence for tenants table to avoid duplicate key errors due to explicit id insert in migration 055.

DO $$
DECLARE
    demo_tenant_id INTEGER;
    t_name TEXT;
BEGIN
    -- Fix the sequence for tenants table to be based on current max id
    PERFORM setval(pg_get_serial_sequence('tenants', 'id'), COALESCE((SELECT MAX(id) FROM tenants), 0) + 1, false);

    -- Insert demo tenant if not exists (using the corrected sequence for id)
    INSERT INTO tenants (name, slug)
    VALUES (
        'Demo Tenant',
        'demo'
    )
    ON CONFLICT (slug) DO NOTHING;

    -- Get demo tenant ID
    SELECT id INTO demo_tenant_id FROM tenants WHERE slug = 'demo' LIMIT 1;

    -- If demo tenant not found (should not happen), fall back to default tenant (id=1)
    IF demo_tenant_id IS NULL THEN
        SELECT id INTO demo_tenant_id FROM tenants WHERE slug = 'default' LIMIT 1;
    END IF;

    -- Core tables backfill
    -- usuarios
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'usuarios') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'usuarios' AND column_name = 'tenant_id') THEN
            UPDATE usuarios SET tenant_id = demo_tenant_id WHERE tenant_id IS NULL;
        END IF;
    END IF;

    -- servicios
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'servicios') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'servicios' AND column_name = 'tenant_id') THEN
            UPDATE servicios SET tenant_id = demo_tenant_id WHERE tenant_id IS NULL;
        END IF;
    END IF;

    -- bookings
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bookings') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'tenant_id') THEN
            UPDATE bookings SET tenant_id = demo_tenant_id WHERE tenant_id IS NULL;
        END IF;
    END IF;

    -- transactions
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'transactions') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'tenant_id') THEN
            UPDATE transactions SET tenant_id = demo_tenant_id WHERE tenant_id IS NULL;
        END IF;
    END IF;

    -- reviews
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'reviews') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reviews' AND column_name = 'tenant_id') THEN
            UPDATE reviews SET tenant_id = demo_tenant_id WHERE tenant_id IS NULL;
        END IF;
    END IF;

    -- portfolio_items
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'portfolio_items') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'portfolio_items' AND column_name = 'tenant_id') THEN
            UPDATE portfolio_items SET tenant_id = demo_tenant_id WHERE tenant_id IS NULL;
        END IF;
    END IF;

    -- messages
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'messages') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'tenant_id') THEN
            UPDATE messages SET tenant_id = demo_tenant_id WHERE tenant_id IS NULL;
        END IF;
    END IF;

    -- nail_tryon_jobs
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'nail_tryon_jobs') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nail_tryon_jobs' AND column_name = 'tenant_id') THEN
            UPDATE nail_tryon_jobs SET tenant_id = demo_tenant_id WHERE tenant_id IS NULL;
        END IF;
    END IF;

    -- sos_alerts
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sos_alerts') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sos_alerts' AND column_name = 'tenant_id') THEN
            UPDATE sos_alerts SET tenant_id = demo_tenant_id WHERE tenant_id IS NULL;
        END IF;
    END IF;

    -- user_activity_logs
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_activity_logs') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_activity_logs' AND column_name = 'tenant_id') THEN
            UPDATE user_activity_logs SET tenant_id = demo_tenant_id WHERE tenant_id IS NULL;
        END IF;
    END IF;

    -- perfiles_prestador
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'perfiles_prestador') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'perfiles_prestador' AND column_name = 'tenant_id') THEN
            UPDATE perfiles_prestador SET tenant_id = demo_tenant_id WHERE tenant_id IS NULL;
        END IF;
    END IF;

    -- Optional tables
    -- platform_config
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'platform_config') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'platform_config' AND column_name = 'tenant_id') THEN
            ALTER TABLE platform_config ADD COLUMN tenant_id INTEGER REFERENCES tenants(id);
        END IF;
        UPDATE platform_config SET tenant_id = demo_tenant_id WHERE tenant_id IS NULL;
    END IF;

    -- admin_mfa
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'admin_mfa') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'admin_mfa' AND column_name = 'tenant_id') THEN
            ALTER TABLE admin_mfa ADD COLUMN tenant_id INTEGER REFERENCES tenants(id);
        END IF;
        UPDATE admin_mfa SET tenant_id = demo_tenant_id WHERE tenant_id IS NULL;
    END IF;

    -- productos
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'productos') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'productos' AND column_name = 'tenant_id') THEN
            ALTER TABLE productos ADD COLUMN tenant_id INTEGER REFERENCES tenants(id);
        END IF;
        UPDATE productos SET tenant_id = demo_tenant_id WHERE tenant_id IS NULL;
    END IF;

    -- beauty_knowledge_embeddings: add column if missing, leave NULL (GLOBAL RAG)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'beauty_knowledge_embeddings') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'beauty_knowledge_embeddings' AND column_name = 'tenant_id') THEN
            ALTER TABLE beauty_knowledge_embeddings ADD COLUMN tenant_id INTEGER REFERENCES tenants(id);
        END IF;
        -- Do not update; leave NULL for global data
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
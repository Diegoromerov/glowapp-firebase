-- D-001 Implementation: Enable RLS and create policies - REPAIRED & ASSERTED
-- This migration enables Row Level Security on tables that need tenant isolation
-- and creates policies to enforce tenant_id based access control.
-- It is idempotent: checks if RLS is already enabled before enabling,
-- and verifies explicit presence of tenant_id column before operating.

DO $$
DECLARE
    rls_tables TEXT[] := ARRAY[
        'usuarios',
        'perfiles_prestador',
        'services',
        'bookings',
        'transactions',
        'reviews',
        'portfolio_items',
        'messages',
        'nail_tryon_jobs',
        'sos_alerts',
        'user_activity_logs',
        'platform_config',
        'admin_mfa',
        'productos'
    ];
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY rls_tables LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl) THEN
            -- Aserción explícita: si la tabla existe en el esquema, DEBE tener la columna tenant_id
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'tenant_id'
            ) THEN
                RAISE EXCEPTION 'MIGRATION ASSERTION ERROR (058): La tabla "%" existe en el esquema pero carece de la columna "tenant_id" para aplicar RLS.', tbl;
            END IF;

            IF NOT (SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = tbl) THEN
                EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
            END IF;
        END IF;
    END LOOP;
END $$;

-- Create/replace policies for each table (idempotent via DROP IF EXISTS)
DO $$
DECLARE
    policy_tables TEXT[] := ARRAY[
        'usuarios',
        'perfiles_prestador',
        'services',
        'bookings',
        'transactions',
        'reviews',
        'portfolio_items',
        'messages',
        'nail_tryon_jobs',
        'sos_alerts',
        'user_activity_logs',
        'platform_config',
        'admin_mfa',
        'productos'
    ];
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY policy_tables LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl) THEN
            -- Aserción explícita: si la tabla existe en el esquema, DEBE tener la columna tenant_id
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'tenant_id'
            ) THEN
                RAISE EXCEPTION 'MIGRATION ASSERTION ERROR (058): La tabla "%" existe en el esquema pero carece de la columna "tenant_id" para aplicar RLS.', tbl;
            END IF;

            EXECUTE format(
                'DROP POLICY IF EXISTS tenant_isolation_%I ON public.%I;'
                || 'CREATE POLICY tenant_isolation_%I ON public.%I'
                || ' FOR ALL'
                || ' USING (tenant_id = current_setting(''app.tenant_id'')::int);',
                tbl, tbl, tbl, tbl
            );
        END IF;
    END LOOP;
END $$;
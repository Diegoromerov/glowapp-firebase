-- ============================================================================
-- Migración 065: Multi-Tenant Hardening
-- ============================================================================
-- Alcance: incorporar tenant_id al modelo multi-sede y normalizar las políticas
--          de aislamiento creadas por la migración 058.
--
-- DECISIONES APLICADAS (2026-09-21):
--   D1. NO se aplica FORCE ROW LEVEL SECURITY. Solo ENABLE. La aplicación
--       conecta como usuario propietario de la BD y forzar RLS antes de
--       refactorizar la capa de acceso haría que las consultas globales
--       devolvieran 0 filas. El aislamiento estricto se resuelve en la capa JS.
--   D2. Toda lectura del contexto usa current_setting('app.tenant_id', true)
--       (missing_ok = true) para no lanzar 'unrecognized configuration
--       parameter' en peticiones públicas o no autenticadas.
--   D3. Columnas añadidas con ALTER TABLE IF EXISTS ... ADD COLUMN IF NOT EXISTS.
--       NO se incluye CREATE TABLE: las tablas ya existen en producción y un
--       CREATE TABLE IF NOT EXISTS con columnas distintas es un no-op silencioso.
--
-- ADVERTENCIA — LEER ANTES DE ACTIVAR RLS EN 066:
--   Con FORCE desactivado y la app conectada como propietaria de las tablas,
--   PostgreSQL NO evalúa estas políticas: quedan registradas e INERTES.
--   Al activar FORCE se requiere, sin excepción:
--     (a) que el 100% de los INSERT declaren tenant_id — hoy 87 de 89 no lo
--         hacen (usuarios 4/4, messages 6/6, wallet_transactions 7/7,
--         salon_miembros 4/4, salones 3/3, ...), y
--     (b) que toda petición autenticada tenga app.tenant_id fijado en su
--         conexión antes de la primera consulta.
--   Sin (a) y (b), FORCE produce 'new row violates row-level security policy'
--   en 14 tablas, incluido el registro de usuarios nuevos.
--
-- Idempotente: se puede reejecutar sin efectos acumulativos.
-- Atómica: envuelta en BEGIN/COMMIT. Recomendado aplicarla con
--   psql -f 065_multi_tenant_hardening.sql
-- en lugar de vía migrationRunner.js, cuyas transacciones son ficticias
-- (usa pool.query para BEGIN/SQL/COMMIT, cada statement puede ir a una
-- conexión distinta del pool).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. Función auxiliar de lectura de contexto
-- ----------------------------------------------------------------------------
-- Centraliza la lectura de app.tenant_id y neutraliza el caso '' que deja
-- tenantContext.js:33 en su reset: sin NULLIF, ''::integer lanzaría
-- 'invalid input syntax for type integer: ""'.
CREATE OR REPLACE FUNCTION app_current_tenant_id()
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::INTEGER;
$$;

COMMENT ON FUNCTION app_current_tenant_id() IS
  'Tenant activo de la sesión. NULL si no hay contexto fijado o si está vacío.';

-- ----------------------------------------------------------------------------
-- 1. tenant_id en las tablas multi-sede que aún no lo tienen
-- ----------------------------------------------------------------------------
-- La columna se añade primero sin FK (idempotente); la FK se añade en el
-- bloque 2 de forma condicional a que la tabla tenants exista.
ALTER TABLE IF EXISTS salones             ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
ALTER TABLE IF EXISTS salon_miembros      ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
ALTER TABLE IF EXISTS salon_invitaciones  ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
ALTER TABLE IF EXISTS provider_wallet     ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
ALTER TABLE IF EXISTS wallet_transactions ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
ALTER TABLE IF EXISTS retiros             ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
ALTER TABLE IF EXISTS disputas            ADD COLUMN IF NOT EXISTS tenant_id INTEGER;

-- La tabla de servicios aparece con dos nombres en este repositorio:
-- 'servicios' (056_add_tenant_id_to_core_tables.sql:7) y 'services'
-- (058_enable_rls_policies.sql:42). Se cubren ambos; IF EXISTS decide cuál.
ALTER TABLE IF EXISTS services            ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
ALTER TABLE IF EXISTS servicios           ADD COLUMN IF NOT EXISTS tenant_id INTEGER;

-- ----------------------------------------------------------------------------
-- 2. FK a tenants(id), condicional
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    t TEXT;
    cname TEXT;
    tablas TEXT[] := ARRAY[
        'salones', 'salon_miembros', 'salon_invitaciones',
        'provider_wallet', 'wallet_transactions', 'retiros', 'disputas',
        'services', 'servicios'
    ];
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = 'tenants') THEN
        RAISE NOTICE '[065] tenants no existe: se omite la FK tenant_id -> tenants(id).';
        RETURN;
    END IF;

    FOREACH t IN ARRAY tablas LOOP
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = t
                          AND column_name = 'tenant_id') THEN
            CONTINUE;
        END IF;

        cname := t || '_tenant_id_fkey';
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = cname) THEN
            EXECUTE format(
                'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES tenants(id);',
                t, cname
            );
            RAISE NOTICE '[065] FK % creada.', cname;
        END IF;
    END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Reafirmar ENABLE ROW LEVEL SECURITY (sin FORCE — decisión D1)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    t TEXT;
    tablas TEXT[] := ARRAY[
        'usuarios', 'perfiles_prestador', 'services', 'servicios', 'bookings',
        'transactions', 'reviews', 'portfolio_items', 'messages',
        'nail_tryon_jobs', 'sos_alerts', 'user_activity_logs', 'platform_config',
        'admin_mfa', 'productos',
        'salones', 'salon_miembros', 'salon_invitaciones',
        'provider_wallet', 'wallet_transactions', 'retiros', 'disputas'
    ];
BEGIN
    FOREACH t IN ARRAY tablas LOOP
        IF EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = t
                      AND column_name = 'tenant_id') THEN
            EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
        END IF;
    END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 4. Políticas por operación
-- ----------------------------------------------------------------------------
-- 058 creaba UNA política 'FOR ALL' con USING y sin WITH CHECK. En PostgreSQL
-- el USING de una política FOR ALL se usa además como WITH CHECK en INSERT y
-- UPDATE, de modo que la política original (a) impedía INSERT sin tenant_id y
-- (b) no distinguía lectura de escritura. Aquí se sustituye por cuatro
-- políticas explícitas, conservando el nombre 'tenant_isolation_<tabla>' en la
-- política de SELECT para que las auditorías que lo busquen lo encuentren.
--
-- Además, 058 solo verificaba que la TABLA existiera, no la COLUMNA: sobre una
-- tabla sin tenant_id el CREATE POLICY fallaba. Aquí se verifica la columna y
-- las tablas que la tengan pendiente se reportan en el bloque 5.
DO $$
DECLARE
    t TEXT;
    tablas TEXT[] := ARRAY[
        'usuarios', 'perfiles_prestador', 'services', 'servicios', 'bookings',
        'transactions', 'reviews', 'portfolio_items', 'messages',
        'nail_tryon_jobs', 'sos_alerts', 'user_activity_logs', 'platform_config',
        'admin_mfa', 'productos',
        'salones', 'salon_miembros', 'salon_invitaciones',
        'provider_wallet', 'wallet_transactions', 'retiros', 'disputas'
    ];
BEGIN
    FOREACH t IN ARRAY tablas LOOP
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = t
                          AND column_name = 'tenant_id') THEN
            CONTINUE;
        END IF;

        -- Limpieza idempotente de los cinco nombres posibles
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_%I ON %I;', t, t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_%I_select ON %I;', t, t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_%I_insert ON %I;', t, t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_%I_update ON %I;', t, t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_%I_delete ON %I;', t, t);

        EXECUTE format(
            'CREATE POLICY tenant_isolation_%I ON %I FOR SELECT USING (tenant_id = app_current_tenant_id());',
            t, t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation_%I_insert ON %I FOR INSERT WITH CHECK (tenant_id = app_current_tenant_id());',
            t, t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation_%I_update ON %I FOR UPDATE USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());',
            t, t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation_%I_delete ON %I FOR DELETE USING (tenant_id = app_current_tenant_id());',
            t, t);
    END LOOP;
END $$;

COMMIT;

-- ----------------------------------------------------------------------------
-- 5. Informe de verificación (solo lectura, no aborta la migración)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    t TEXT;
    sin_columna TEXT := '';
    sin_rls TEXT := '';
    con_filas_sin_tenant TEXT := '';
    n BIGINT;
    tablas TEXT[] := ARRAY[
        'salones', 'salon_miembros', 'salon_invitaciones',
        'provider_wallet', 'wallet_transactions', 'retiros', 'disputas',
        'services', 'servicios',
        'usuarios', 'bookings', 'transactions', 'reviews', 'messages',
        'perfiles_prestador', 'productos', 'portfolio_items',
        'nail_tryon_jobs', 'sos_alerts', 'user_activity_logs'
    ];
BEGIN
    FOREACH t IN ARRAY tablas LOOP
        IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                        WHERE table_schema = 'public' AND table_name = t) THEN
            CONTINUE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = t
                          AND column_name = 'tenant_id') THEN
            sin_columna := sin_columna || t || ' ';
            CONTINUE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_class c
                        JOIN pg_namespace ns ON ns.oid = c.relnamespace
                       WHERE ns.nspname = 'public' AND c.relname = t
                         AND c.relrowsecurity) THEN
            sin_rls := sin_rls || t || ' ';
        END IF;

        EXECUTE format('SELECT COUNT(*) FROM %I WHERE tenant_id IS NULL', t) INTO n;
        IF n > 0 THEN
            con_filas_sin_tenant := con_filas_sin_tenant || t || '(' || n || ') ';
        END IF;
    END LOOP;

    RAISE NOTICE '[065] Tablas sin columna tenant_id: %', COALESCE(NULLIF(sin_columna, ''), 'ninguna');
    RAISE NOTICE '[065] Tablas sin RLS habilitado:    %', COALESCE(NULLIF(sin_rls, ''), 'ninguna');
    RAISE NOTICE '[065] Filas con tenant_id NULL:     %', COALESCE(NULLIF(con_filas_sin_tenant, ''), 'ninguna');
    RAISE NOTICE '[065] FORCE ROW LEVEL SECURITY:     NO aplicado por decisión (ver cabecera).';
END $$;

-- backend/migrations/069_ensure_app_system_role.sql
-- Crea de forma segura el rol de sistema para jobs de cron y webhooks cross-tenant

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_system') THEN
    CREATE ROLE app_system NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'No hay permisos de superusuario para crear el rol app_system; omitiendo.';
  WHEN OTHERS THEN
    RAISE NOTICE 'No se pudo crear el rol app_system: %', SQLERRM;
END $$;

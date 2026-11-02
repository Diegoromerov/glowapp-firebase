-- ============================================================================
-- Roles de PostgreSQL para aislamiento multi-tenant
-- ============================================================================
-- NO es una migración de esquema: es configuración de despliegue. Ejecutar una
-- vez por entorno, como superusuario.
--
--   docker exec -i <pg> psql -U postgres -d <db> < backend/scripts/setupRlsRole.sql
--
-- DESPUÉS: apuntar DATABASE_URL a app_rls_user y DB_SYSTEM_URL a app_system.
--
-- POR QUÉ DOS ROLES
-- -----------------
--   app_rls_user  La aplicación. NO propietario de las tablas y NO
--                 superusuario, para que PostgreSQL evalúe las políticas. Con
--                 FORCE activo el propietario también queda sujeto, así que
--                 este rol es la segunda línea de defensa: si alguien quitara
--                 FORCE, el aislamiento seguiría en pie.
--
--   app_system    Los caminos que NO nacen de una petición autenticada y por
--                 tanto no tienen inquilino: el webhook de Wompi y los jobs de
--                 cron. Necesitan BYPASSRLS porque operan de forma
--                 intencionadamente cross-tenant (el webhook confirma la cita
--                 de CUALQUIER salón a partir de una referencia firmada).
--                 Un superusuario NO es la respuesta: bypassa todo, incluido lo
--                 que no debería. BYPASSRLS solo salta RLS.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Rol de la aplicación: aislado
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rls_user') THEN
    CREATE ROLE app_rls_user LOGIN
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
    RAISE NOTICE 'app_rls_user creado. Fija su contraseña por separado (ALTER ROLE ... PASSWORD).';
  END IF;
END $$;

-- GRANT no admite una expresión en el nombre de la base: hay que componerlo.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_rls_user', current_database());
END $$;

GRANT USAGE   ON SCHEMA public TO app_rls_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO app_rls_user;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO app_rls_user;

-- Que las tablas futuras también queden accesibles sin repetir el GRANT.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rls_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_rls_user;

-- ---------------------------------------------------------------------------
-- 2. Rol de sistema: solo para webhooks y jobs
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_system') THEN
    -- NOLOGIN a propósito: este rol NO se usa para conectarse, sino como destino
    -- de un `SET LOCAL ROLE app_system` dentro de una transacción. Un rol
    -- privilegiado que además acepta conexiones directas es una credencial más
    -- que proteger sin aportar nada.
    CREATE ROLE app_system NOLOGIN
      NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;

-- Membresía: app_rls_user puede ESCALAR a app_system dentro de una transacción
-- (mecanismo de los caminos sin petición autenticada, ver §1b). Va DESPUÉS del
-- CREATE ROLE de arriba: es la corrección del orden que rompía la base vacía.
GRANT app_system TO app_rls_user;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_system', current_database());
END $$;
GRANT USAGE   ON SCHEMA public TO app_system;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO app_system;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO app_system;

-- ---------------------------------------------------------------------------
-- 1b. Membresía: app_rls_user puede ESCALAR a app_system dentro de una
--     transacción. Es el mecanismo para los caminos sin petición autenticada.
-- ---------------------------------------------------------------------------
-- El webhook de Wompi y los jobs no tienen sesión de usuario y operan de forma
-- intencionadamente cross-tenant. En vez de un segundo pool —que obligaría a una
-- segunda instancia de Sequelize, con los modelos duplicados— o de un
-- superusuario —que bypassa todo, incluido lo que no debería— la aplicación hace:
--
--     BEGIN; SET LOCAL ROLE app_system;   -- current_user pasa a tener BYPASSRLS
--     ... consultas cross-tenant ...; COMMIT;
--
-- SET LOCAL ROLE es de alcance transaccional: al COMMIT/ROLLBACK la conexión
-- recupera su rol original, así que no queda una conexión privilegiada en el
-- pool. La contrapartida es que esta concesión permite escalar privilegios, de
-- modo que el código de aplicación NO debe ejecutar SET ROLE fuera de los dos
-- puntos autorizados (backend/src/config/tenantRouting.js: runAsSystem*) y hay
-- que auditar que siga siendo así:
--
--     grep -rn "SET ROLE\|set_config('app.system'" backend/src --include=*.js
--
GRANT app_system TO app_rls_user;

-- ---------------------------------------------------------------------------
-- 3. Verificación: que los roles tengan los atributos que dicen tener
-- ---------------------------------------------------------------------------
SELECT rolname || ' | superusuario=' || rolsuper || ' | bypassrls=' || rolbypassrls
       || CASE WHEN rolname = 'app_rls_user' AND (rolsuper OR rolbypassrls)
               THEN '  <-- ERROR: app_rls_user NO debe saltarse RLS'
               WHEN rolname = 'app_system' AND rolsuper
               THEN '  <-- ERROR: app_system no necesita ser superusuario'
               ELSE '' END AS estado
  FROM pg_roles WHERE rolname IN ('app_rls_user', 'app_system')
 ORDER BY rolname;

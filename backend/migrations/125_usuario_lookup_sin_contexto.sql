-- 125 — Resolución de usuarios fuera del contexto de inquilino
--
-- PROBLEMA
-- --------
-- Con RLS activa, un `SELECT ... FROM usuarios WHERE email = $1` solo ve las
-- filas del inquilino en contexto. Un usuario que pertenece a otro inquilino
-- resulta invisible, así que:
--
--   · el alta por Google/Facebook no lo encuentra y hace INSERT
--   · el registro local no comprueba nada y hace INSERT directo
--
-- En ambos casos choca con el índice único global `usuarios_email_key` y la API
-- devuelve 500 «duplicate key value violates unique constraint».
--
-- SOLUCIÓN
-- --------
-- Estas funciones son SECURITY DEFINER con `search_path` fijo: resuelven la
-- existencia del email contra TODA la tabla, sin depender del contexto. No
-- devuelven nada que el llamador no necesite para autenticar.

-- 1. Buscar por email (para detectar duplicados antes de insertar)
CREATE OR REPLACE FUNCTION app_usuario_por_email(p_email text)
RETURNS TABLE (
  id                   integer,
  email                varchar,
  nombre               varchar,
  rol                  tipo_rol,
  auth_provider        tipo_auth_provider,
  provider_id          varchar,
  tenant_id            integer,
  onboarding_completo  boolean,
  is_active            boolean,
  foto_url             text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.email, u.nombre, u.rol, u.auth_provider, u.provider_id,
         u.tenant_id, u.onboarding_completo, u.is_active, u.foto_url
  FROM usuarios u
  WHERE lower(u.email) = lower(p_email)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION app_usuario_por_email(text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rls_user') THEN
    GRANT EXECUTE ON FUNCTION app_usuario_por_email(text) TO app_rls_user;
  END IF;
END $$;

-- 2. Alta o vinculación de cuenta social (find-or-create atómico)
--    Si el email existe se vincula el proveedor sin tocar el inquilino del
--    usuario; si no existe, nace en el inquilino de plataforma.
CREATE OR REPLACE FUNCTION app_oauth_upsert_usuario(
  p_email       text,
  p_nombre      varchar,
  p_provider    tipo_auth_provider,
  p_provider_id varchar,
  p_rol         tipo_rol,
  p_onboarding  boolean
)
RETURNS TABLE (
  id                   integer,
  email                varchar,
  nombre               varchar,
  rol                  tipo_rol,
  auth_provider        tipo_auth_provider,
  provider_id          varchar,
  tenant_id            integer,
  onboarding_completo  boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id     integer;
  v_tenant integer;
BEGIN
  SELECT u.id INTO v_id
  FROM usuarios u
  WHERE lower(u.email) = lower(p_email)
  LIMIT 1;

  IF v_id IS NULL THEN
    SELECT t.id INTO v_tenant
    FROM tenants t
    WHERE t.es_plataforma
    ORDER BY t.id
    LIMIT 1;

    INSERT INTO usuarios (nombre, email, auth_provider, provider_id, rol,
                          onboarding_completo, tenant_id)
    VALUES (p_nombre, p_email, p_provider, p_provider_id, p_rol,
            p_onboarding, v_tenant)
    RETURNING usuarios.id INTO v_id;
  ELSE
    UPDATE usuarios u
       SET auth_provider = p_provider,
           provider_id   = p_provider_id
     WHERE u.id = v_id
       AND (u.auth_provider IS DISTINCT FROM p_provider
            OR u.provider_id IS DISTINCT FROM p_provider_id);
  END IF;

  RETURN QUERY
    SELECT u.id, u.email, u.nombre, u.rol, u.auth_provider, u.provider_id,
           u.tenant_id, u.onboarding_completo
    FROM usuarios u
    WHERE u.id = v_id;
END $$;

REVOKE ALL ON FUNCTION app_oauth_upsert_usuario(text, varchar, tipo_auth_provider, varchar, tipo_rol, boolean) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rls_user') THEN
    GRANT EXECUTE ON FUNCTION app_oauth_upsert_usuario(text, varchar, tipo_auth_provider, varchar, tipo_rol, boolean) TO app_rls_user;
  END IF;
END $$;

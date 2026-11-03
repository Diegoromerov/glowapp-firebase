-- El login debe resolver un usuario por email ANTES de tener contexto de
-- inquilino. Con RLS activo, un SELECT directo sobre `usuarios` devuelve 0 filas
-- y el login responde 401 aunque las credenciales sean correctas.
--
-- SECURITY DEFINER con `search_path` fijo y devolviendo SOLO las columnas que la
-- autenticación necesita: nunca el usuario completo.
CREATE OR REPLACE FUNCTION app_usuario_para_login(p_email text)
RETURNS TABLE (
  id             integer,
  email          varchar,
  nombre         varchar,
  password_hash  varchar,
  rol            tipo_rol,
  auth_provider  tipo_auth_provider,
  provider_id    varchar,
  tenant_id      integer,
  onboarding_completo boolean,
  is_active      boolean,
  foto_url       text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.email, u.nombre, u.password_hash, u.rol, u.auth_provider,
         u.provider_id, u.tenant_id, u.onboarding_completo, u.is_active, u.foto_url
    FROM usuarios u
   WHERE lower(u.email) = lower(p_email)
   LIMIT 1;
$$;

-- Solo el rol de la aplicación puede invocarla; los demás roles no necesitan.
REVOKE ALL ON FUNCTION app_usuario_para_login(text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rls_user') THEN
    GRANT EXECUTE ON FUNCTION app_usuario_para_login(text) TO app_rls_user;
  END IF;
END $$;

-- Se aplica en cada arranque para que un `CREATE OR REPLACE` posterior no pierda
-- los permisos.
-- ============================================================================
-- 084: restaurar las funciones SECURITY DEFINER de identidad (RLS)
-- ============================================================================
-- SÍNTOMA QUE ARREGLA
-- ------------------
-- Toda petición AUTENTICADA devolvía HTTP 503.
--
-- CAUSA RAÍZ (deriva de migración, no bug de código)
-- --------------------------------------------------
-- `authMiddleware` resuelve la identidad EXCLUSIVAMENTE por la función
-- SECURITY DEFINER `app_usuario_identidad($1::integer)` (ver
-- src/middleware/auth.js, migración 068). Si la función no existe, falla
-- CERRADO con 503 — a propósito: degradar a una lectura directa de `usuarios`
-- bajo RLS+FORCE devolvería 0 filas y convertiría el arranque de identidad en un
-- 401 global (lo fija tests/rls_usuarios_isolation.nodetest.js).
--
-- El problema: el fichero de la migración 068 se EDITÓ DESPUÉS de haberse
-- aplicado en producción. El runner detecta la deriva por checksum y se niega a
-- re-aplicarla ("Deriva de migración: 068_force_rls_strict_isolation.sql cambió
-- después de aplicarse ... No se re-aplica; revisar a mano"). Las funciones que
-- se le añadieron en esa edición nunca llegaron a la base:
--
--   presentes:  app_current_tenant_id, app_assign_tenant_id
--   AUSENTES:   app_usuario_identidad, app_usuario_por_id,
--               app_usuario_por_email, app_current_user_id
--
-- Esta migración las restaura con la MISMA definición del repositorio. Va en un
-- número nuevo (084) precisamente para esquivar el guard de deriva.
--
-- Idempotente: CREATE OR REPLACE + GRANTs condicionados a que el rol exista.
-- ============================================================================

BEGIN;

-- Sujeto de la petición (el `id` del usuario del token). Sin contexto devuelve
-- NULL (`missing_ok = true`) y NUNCA lanza error.
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::integer
$$;

-- Lecturas de identidad que NO pueden tener contexto de inquilino (login /
-- arranque por id o por email). Atraviesan RLS de forma deliberada y localizada.
CREATE OR REPLACE FUNCTION app_usuario_por_id(p_id integer)
RETURNS SETOF public.usuarios
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.usuarios WHERE id = p_id
$$;

CREATE OR REPLACE FUNCTION app_usuario_por_email(p_email text)
RETURNS SETOF public.usuarios
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.usuarios WHERE lower(email) = lower(p_email)
$$;

-- La que consume authMiddleware. Devuelve columnas mínimas para no depender del
-- DDL completo de `usuarios`.
CREATE OR REPLACE FUNCTION app_usuario_identidad(p_id integer)
RETURNS TABLE(rol public.tipo_rol, tenant_id integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.rol, u.tenant_id FROM public.usuarios u WHERE u.id = p_id
$$;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['app_rls_user','app_owner','app_system'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION app_usuario_por_id(integer)   TO %I', r);
      EXECUTE format('GRANT EXECUTE ON FUNCTION app_usuario_por_email(text)   TO %I', r);
      EXECUTE format('GRANT EXECUTE ON FUNCTION app_usuario_identidad(integer) TO %I', r);
    END IF;
  END LOOP;
END $$;

-- Verificación interna: si alguna quedó ausente, abortar en voz alta.
DO $$
DECLARE faltan text;
BEGIN
  SELECT string_agg(f, ', ') INTO faltan
  FROM unnest(ARRAY['app_usuario_identidad(integer)','app_usuario_por_id(integer)',
                    'app_usuario_por_email(text)','app_current_user_id()']) AS f
  WHERE to_regprocedure(f) IS NULL;

  IF faltan IS NOT NULL THEN
    RAISE EXCEPTION '084: siguen ausentes las funciones: %', faltan;
  END IF;
END $$;

COMMIT;

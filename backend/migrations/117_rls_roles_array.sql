-- ============================================================================
-- Migración 116: Soporte RLS por roles[] en JWT (Fase 6)
-- ============================================================================
-- QUÉ HACE
-- ---------
-- 1. Función app_current_user_roles(): extrae array de roles del JWT actual
-- 2. Función app_has_role(role): verifica si el usuario actual tiene un rol específico
-- 3. Función app_has_any_role(roles[]): verifica si el usuario tiene ALGUNO de los roles
-- 4. Ejemplos de políticas RLS usando roles[]
--
-- CONTEXTO
-- --------
-- El JWT ahora incluye campo `roles: string[]` (ej: ['client', 'provider', 'owner'])
-- Las políticas RLS pueden usar este array para control de acceso granular
-- sin necesidad de consultar tablas de memberships en cada query.
--
-- REQUISITO
-- ---------
-- El middleware de autenticación DEBE fijar `app.user_roles` en la conexión
-- (similar a app.tenant_id y app.user_id) antes de ejecutar consultas.
--
-- IDEMPOTENTE: se puede ejecutar varias veces.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Función para fijar roles del usuario en la sesión (llamar desde middleware)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_set_user_roles(roles_json jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Guardar roles como JSON en setting de sesión (is_local = true para transacción)
  PERFORM set_config('app.user_roles', roles_json::text, true);
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. Obtener roles del usuario actual desde el setting de sesión
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_current_user_roles()
RETURNS text[]
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.user_roles', true), '')::jsonb,
    '[]'::jsonb
  )::text[];
$$;

-- ---------------------------------------------------------------------------
-- 2. Verificar si el usuario tiene un rol específico
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_has_role(role_name text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT role_name = ANY(app_current_user_roles());
$$;

-- ---------------------------------------------------------------------------
-- 3. Verificar si el usuario tiene ALGUNO de los roles (OR lógico)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_has_any_role(roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM unnest(roles) AS r(role)
    WHERE r.role = ANY(app_current_user_roles())
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. Verificar si el usuario tiene TODOS los roles (AND lógico)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_has_all_roles(roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM unnest(roles) AS r(role)
    WHERE r.role <> ALL(app_current_user_roles())
  );
$$;

-- ---------------------------------------------------------------------------
-- 5. Helper: rol principal del usuario (primer elemento del array)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_current_primary_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT r FROM unnest(app_current_user_roles()) AS r ORDER BY r LIMIT 1),
    'client'
  );
$$;

-- ---------------------------------------------------------------------------
-- 6. Verificar si es audiencia cliente (app glow_client)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_is_client_audience()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT app_has_role('client') AND NOT app_has_role('provider') AND NOT app_has_role('salon') AND NOT app_has_role('admin');
$$;

-- ---------------------------------------------------------------------------
-- 7. Verificar si es audiencia prestador/salón (app glow_provider)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_is_provider_audience()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT app_has_any_role(ARRAY['provider', 'salon', 'owner', 'manager', 'staff']);
$$;

-- ---------------------------------------------------------------------------
-- 8. Verificar si es audiencia admin
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_is_admin_audience()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT app_has_role('admin');
$$;

-- ---------------------------------------------------------------------------
-- 9. Ejemplo: Política RLS para tabla 'services' usando roles[]
--      - CLIENT: solo ve servicios publicados (is_published = true)
--      - PROVIDER/SALON/OWNER/MANAGER: ve servicios de su tenant
--      - ADMIN: ve todo (BYPASSRLS en rol admin)
-- ---------------------------------------------------------------------------
-- NOTA: Esta política es EJEMPLO. Se aplica en migración separada si se desea.
/*
DROP POLICY IF EXISTS services_rls_by_roles ON services;
CREATE POLICY services_rls_by_roles ON services
  FOR ALL
  USING (
    -- Admin bypass (rol tiene BYPASSRLS, pero por si acaso)
    app_has_role('admin')
    OR
    -- Provider/salon/owner/manager: tenant isolation
    (app_has_any_role(ARRAY['provider', 'salon', 'owner', 'manager', 'staff']) 
     AND tenant_id = app_current_tenant_id())
    OR
    -- Client: solo servicios publicados
    (app_has_role('client') AND is_published = true)
  )
  WITH CHECK (
    app_has_role('admin')
    OR
    (app_has_any_role(ARRAY['provider', 'salon', 'owner', 'manager', 'staff']) 
     AND tenant_id = app_current_tenant_id())
    -- Clients no pueden escribir en services
  );
*/

-- ---------------------------------------------------------------------------
-- 10. Ejemplo: Política RLS para tabla 'bookings' usando roles[]
--       - CLIENT: ve sus propias reservas (user_id = app_current_user_id())
--       - PROVIDER/SALON: ve reservas de su tenant
--       - ADMIN: ve todo
-- ---------------------------------------------------------------------------
/*
DROP POLICY IF EXISTS bookings_rls_by_roles ON bookings;
CREATE POLICY bookings_rls_by_roles ON bookings
  FOR ALL
  USING (
    app_has_role('admin')
    OR
    (app_has_any_role(ARRAY['provider', 'salon', 'owner', 'manager', 'staff']) 
     AND tenant_id = app_current_tenant_id())
    OR
    (app_has_role('client') AND user_id = app_current_user_id())
  )
  WITH CHECK (
    app_has_role('admin')
    OR
    (app_has_any_role(ARRAY['provider', 'salon', 'owner', 'manager', 'staff']) 
     AND tenant_id = app_current_tenant_id())
    OR
    (app_has_role('client') AND user_id = app_current_user_id())
  );
*/

-- ---------------------------------------------------------------------------
-- 11. Verificación: comprobar que las funciones existen y funcionan
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  test_roles text[] := ARRAY['client', 'provider', 'owner'];
BEGIN
  -- Test app_set_user_roles + app_current_user_roles
  PERFORM app_set_user_roles(test_roles::jsonb);
  ASSERT (SELECT app_current_user_roles()) @> ARRAY['client', 'provider', 'owner'],
    'app_current_user_roles falló';
  
  -- Test app_has_role
  ASSERT app_has_role('client') = true, 'app_has_role(client) falló';
  ASSERT app_has_role('admin') = false, 'app_has_role(admin) falló';
  
  -- Test app_has_any_role
  ASSERT app_has_any_role(ARRAY['client', 'admin']) = true, 'app_has_any_role falló';
  ASSERT app_has_any_role(ARRAY['admin', 'superadmin']) = false, 'app_has_any_role falló';
  
  -- Test app_has_all_roles
  ASSERT app_has_all_roles(ARRAY['client', 'provider']) = true, 'app_has_all_roles falló';
  ASSERT app_has_all_roles(ARRAY['client', 'admin']) = false, 'app_has_all_roles falló';
  
  -- Test app_current_primary_role
  ASSERT app_current_primary_role() = 'client', 'app_current_primary_role falló';
  
  RAISE NOTICE '✅ Tests de funciones RLS por roles[] PASARON';
END $$;

COMMIT;

-- ============================================================================
-- NOTAS DE INTEGRACIÓN BACKEND (Node.js)
-- ============================================================================
-- En backend/src/middleware/auth.js (o tenantContext.js), DESPUÉS de verificar
-- el JWT y ANTES de llamar a tenantContext, agregar:
--
--   // Fijar roles[] del JWT en la sesión PG para políticas RLS
--   if (req.user && Array.isArray(req.user.roles) && req.user.roles.length > 0) {
--     await pool.query('SELECT app_set_user_roles($1::jsonb)', [JSON.stringify(req.user.roles)]);
--   }
--
-- Esto debe ejecutarse DENTRO de la transacción de tenantContext para que
-- el setting is_local=true sobreviva hasta el final de la petición.
-- ============================================================================
-- ============================================================================
-- Migración 068: Aislamiento multi-tenant ESTRICTO
--               (políticas correctas + FORCE ROW LEVEL SECURITY + relleno de tenant_id)
-- ============================================================================
-- QUÉ ARREGLA
-- -----------
-- La capa de RLS existente no aislaba nada, por cuatro defectos que se
-- tapaban entre sí:
--
--   1. NUNCA se usaba FORCE. El rol que usa la aplicación es el PROPIETARIO de
--      las tablas, y PostgreSQL exceptúa al propietario de las políticas
--      (salvo con FORCE). Medido: `force=false` en las 10 tablas.
--   2. `056`/`065` crean políticas permisivas ADICIONALES por tabla
--      (`tenant_isolation_<t>`, `_insert`, `_update`, `_delete`). Las políticas
--      permisivas se **OR-ean**: una política laxa anula a una estricta. Además
--      la de tipo ALL usa `current_setting('app.tenant_id')` SIN `missing_ok`,
--      que **lanza error** —no devuelve 0 filas— cuando no hay contexto fijado,
--      y su `::integer` explota con `''` (invalid input syntax for type integer).
--   3. `058` referencia tablas que no existen (`sos_alerts`,
--      `user_activity_logs`, `admin_mfa`, `platform_config`) y usaba `servicios`
--      en vez de `services`. Sus bloques IF EXISTS **saltan en silencio**, que
--      es de dónde salen las "12 tablas con RLS y cero políticas".
--   4. De los 89 INSERT del backend solo 2 escriben `tenant_id`. Sin relleno,
--      activar FORCE haría fallar el WITH CHECK en casi toda escritura.
--
-- QUÉ HACE
-- --------
--   0. Garantiza `tenant_id` en las 4 tablas de DINERO (provider_wallet,
--      wallet_transactions, retiros, disputas) DENTRO de 068. Su DDL vive en el
--      repositorio (001_payment_system.sql), así que ya no se las puede eximir
--      del aislamiento: antes se las saltaba en silencio y quedaban sin aislar.
--   1. `app_current_tenant_id()`: `NULLIF(current_setting(..., true), '')::integer`.
--      El `true` es `missing_ok`: sin contexto devuelve NULL (0 filas), no error.
--   2. BORRA TODAS las políticas de cada tabla objetivo, sea cual sea su
--      nombre, y crea UNA sola `FOR ALL` con USING **y** WITH CHECK. Borrar es
--      imprescindible: dejar una permisiva suelta reabre el agujero por OR.
--   3. Trigger BEFORE INSERT que rellena `tenant_id` desde el contexto.
--   4. FORCE ROW LEVEL SECURITY: ahora las políticas también obligan al
--      propietario.
--
-- `usuarios`: RLS EN VIGOR (ya no es una exclusión)
-- ------------------------------------------------
--   La versión anterior DESACTIVABA RLS en `usuarios` (`DISABLE ROW LEVEL
--   SECURITY`) para no romper el arranque de identidad: `auth.js` la consulta
--   para DESCUBRIR el inquilino (`SELECT rol, tenant_id FROM usuarios WHERE
--   id = $1`) cuando todavía no hay contexto. El coste de aquella decisión era
--   una fuga de PII cross-tenant: con RLS apagado, CUALQUIER consulta (de
--   cualquier inquilino, o sin contexto) leía TODAS las filas de usuarios.
--
--   Ahora `usuarios` queda AISLADA POR FILA como las demás tablas, y el arranque
--   de identidad se conserva por una vía EXPLÍCITA y auditable — funciones
--   SECURITY DEFINER, no acceso directo:
--     * `app_current_user_id()`: el sujeto del token en curso (`app.user_id`).
--     * Política única `usuarios_isolation`:
--         - la propia fila (`id = app_current_user_id()`);
--         - las filas del inquilino en curso (`tenant_id = app_current_tenant_id()`).
--       Sin contexto Y sin sujeto => 0 filas (falla CERRADO, no lanza error).
--     * Funciones SECURITY DEFINER para las lecturas que NO pueden tener
--       contexto (login/arranque por email o id). Ejecutan con los privilegios de
--       quien aplica la migración (rol no sujeto a la política de esta tabla), de
--       modo que atraviesan RLS de forma deliberada y localizada:
--         app_usuario_identidad(integer)  -> (rol, tenant_id)
--         app_usuario_por_id(integer)     -> SETOF usuarios
--         app_usuario_por_email(text)     -> SETOF usuarios
--
--   RIESGO RESIDUAL (declarado): las lecturas/escrituras de `usuarios` que haga
--   la aplicación con contexto de inquilino (JOINs, listados, UPDATEs) siguen
--   funcionando SÓLO si la conexión lleva fijado `app.tenant_id`; las que vayan
--   por id/email fuera de contexto deben usar las funciones SECURITY DEFINER de
--   arriba. Ver backend/scripts/verifyTenantIsolation.js, que ahora exige RLS +
--   FORCE + 1 política en `usuarios` y prueba que un inquilino NO ve la PII de
--   otro.
--
-- REQUISITO DE OPERACIÓN
-- ----------------------
-- Con FORCE activo, una consulta SIN contexto devuelve 0 filas en estas tablas.
-- Los caminos que no nacen de una petición autenticada (webhook de Wompi, jobs
-- de cron) DEBEN fijar el contexto por su cuenta antes de leer o escribir.
--
-- IDEMPOTENTE: se puede ejecutar varias veces.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Contexto
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_current_tenant_id() RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::integer
$$;

-- Sujeto de la petición (el `id` del usuario del token). Igual que el inquilino,
-- sin contexto devuelve NULL (`missing_ok = true`) y NUNCA lanza error.
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::integer
$$;

CREATE OR REPLACE FUNCTION app_assign_tenant_id() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := app_current_tenant_id();
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 0b. tenant_id en las tablas de DINERO (garantía propia, idempotente)
-- ---------------------------------------------------------------------------
-- El DDL de estas tablas SÍ está en el repositorio (001_payment_system.sql) y
-- 065 ya les añade tenant_id, pero 068 no puede depender de que 065 se haya
-- aplicado: un esquema creado por init.sql + 001 (o por db_create_disputas.js /
-- index.js) tiene las 4 tablas SIN tenant_id. Antes se las saltaba en silencio
-- ("externas") y quedaban SIN AISLAR. Aquí se garantiza la columna y, al estar
-- ya en el arreglo `tablas`, el bucle de abajo les aplica política + trigger +
-- ENABLE/FORCE como a cualquier tabla del repositorio.
ALTER TABLE IF EXISTS provider_wallet     ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
ALTER TABLE IF EXISTS wallet_transactions ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
ALTER TABLE IF EXISTS retiros             ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
ALTER TABLE IF EXISTS disputas            ADD COLUMN IF NOT EXISTS tenant_id INTEGER;

-- ---------------------------------------------------------------------------
-- 1. Tablas con datos propiedad de un inquilino.
--    Si la tabla no existe en este esquema se informa en voz alta y se sigue;
--    lo que NO se permite es dejarla con RLS activo y sin política.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t            text;
  politicas    int;
  cubiertas    text[] := ARRAY[]::text[];
  ausentes     text[] := ARRAY[]::text[];
  sin_aislar   text[] := ARRAY[]::text[];
  -- Tablas cuyo DDL NO está en el repositorio. Hoy no hay ninguna: las 4 tablas
  -- de DINERO que antes vivían aquí (provider_wallet, wallet_transactions,
  -- retiros, disputas) SÍ tienen su DDL versionado en
  -- 001_payment_system.sql, así que se tratan como tablas del repositorio y su
  -- tenant_id se garantiza en el paso 0b. Si aparece una tabla realmente
  -- externa, o se versiona su DDL en el repositorio o se lista aquí: nunca se
  -- la deja con RLS activo y sin política.
  externas text[] := ARRAY[]::text[];
  tablas text[] := ARRAY[
    -- presentes en cualquier esquema (creadas por init.sql)
    'services',
    'bookings',
    'transactions',
    'messages',
    'reviews',
    'portfolio_items',
    'nail_tryon_jobs',
    'perfiles_prestador',
    'productos',
    -- creadas por 067_create_multi_salon_ddl.sql
    'salones',
    'salon_miembros',
    'salon_invitaciones',
    -- tablas de DINERO: DDL en 001_payment_system.sql; tenant_id garantizado en 0b
    'provider_wallet',
    'wallet_transactions',
    'retiros',
    'disputas'
  ];
BEGIN
  FOREACH t IN ARRAY (tablas || externas) LOOP

    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r'
    ) THEN
      RAISE NOTICE '068: "%" no existe en este esquema — se omite (revisar en producción)', t;
      ausentes := ausentes || t;
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = t AND column_name = 'tenant_id'
    ) THEN
      -- Tabla que el repositorio no gobierna: se informa y se sigue. El silencio
      -- no es aceptable (queda SIN aislar), pero tampoco lo es tumbar todo lo
      -- demás por su culpa.
      IF t = ANY(externas) THEN
        RAISE NOTICE
          '068: "%" EXISTE pero SIN tenant_id y su DDL no está en el repositorio, '
          'así que la columna no se puede derivar aquí. QUEDA SIN AISLAR: añádela '
          'y vuelve a aplicar 068.', t;
        sin_aislar := sin_aislar || t;
        CONTINUE;
      END IF;

      -- Tabla del repositorio: 056/065 deberían haberle puesto la columna. Si no
      -- la tiene, es un error de esas migraciones y aquí sí se rompe.
      RAISE EXCEPTION
        '068: "%" existe pero no tiene tenant_id. Sin esa columna no hay nada que aislar: '
        'aplica 056/065 para esa tabla antes que 068.', t;
    END IF;

    -- 1a. Borrar TODAS las políticas de la tabla. Dejar una permisiva suelta
    --     anularía la estricta por OR.
    SELECT count(*) INTO politicas FROM pg_policies WHERE schemaname = 'public' AND tablename = t;
    EXECUTE format(
      'DO $inner$ DECLARE p record; BEGIN '
      'FOR p IN SELECT policyname FROM pg_policies '
      '          WHERE schemaname = ''public'' AND tablename = %L LOOP '
      '  EXECUTE format(''DROP POLICY %%I ON public.%%I'', p.policyname, %L); '
      'END LOOP; END $inner$;', t, t
    );

    -- 1b. Una única política, con WITH CHECK para cubrir también la escritura.
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I FOR ALL '
      'USING  (tenant_id IS NOT NULL AND tenant_id = app_current_tenant_id()) '
      'WITH CHECK (tenant_id IS NOT NULL AND tenant_id = app_current_tenant_id())',
      t
    );

    -- 1c. Relleno de tenant_id en INSERT.
    EXECUTE format('DROP TRIGGER IF EXISTS trg_assign_tenant_id ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_assign_tenant_id BEFORE INSERT ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION app_assign_tenant_id()', t
    );

    -- 1d. Habilitar y FORZAR.
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY', t);

    cubiertas := cubiertas || t;
    RAISE NOTICE '068: % asegurada (borradas % políticas previas -> 1 política + trigger + FORCE)',
      t, politicas;
  END LOOP;

  RAISE NOTICE '068: % tablas aseguradas, % ausentes en este esquema, % externas SIN AISLAR (sin tenant_id)',
    array_length(cubiertas, 1),
    COALESCE(array_length(ausentes, 1), 0),
    COALESCE(array_length(sin_aislar, 1), 0);
END $$;

-- ---------------------------------------------------------------------------
-- 2. usuarios: RLS en vigor + arranque de identidad por funciones EXPLÍCITAS.
--    Ver la cabecera. Esta sección reemplaza la anterior, que DESACTIVABA RLS
--    en `usuarios` y con ello permitía leer la PII de TODOS los inquilinos.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  p record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relname = 'usuarios' AND c.relkind = 'r') THEN
    RAISE NOTICE '068: "usuarios" no existe en este esquema — se omite';
    RETURN;
  END IF;

  -- 2a. Borrar TODAS las políticas previas de usuarios. Dejar una permisiva
  --     suelta (056/058 creaban 4) anularía la estricta por OR.
  FOR p IN SELECT policyname FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'usuarios' LOOP
    EXECUTE format('DROP POLICY %I ON public.usuarios', p.policyname);
  END LOOP;

  -- 2b. UNA sola política: propia fila (arranque de identidad) o filas del
  --     inquilino en curso. Sin contexto Y sin sujeto => 0 filas (falla cerrado).
  EXECUTE $pol$
    CREATE POLICY usuarios_isolation ON public.usuarios FOR ALL
      USING (
        id = app_current_user_id()
        OR (tenant_id IS NOT NULL AND tenant_id = app_current_tenant_id())
      )
      WITH CHECK (
        id = app_current_user_id()
        OR (tenant_id IS NOT NULL AND tenant_id = app_current_tenant_id())
        -- Alta de usuario (registro local / primer login OAuth): ocurre SIN
        -- sujeto todavía. Sin esta válvula el alta sería imposible; una vez que
        -- hay sujeto autenticado, la escritura vuelve a exigir pertenencia.
        OR app_current_user_id() IS NULL
      )
  $pol$;

  -- 2c. Relleno de tenant_id en INSERT cuando SÍ hay contexto de inquilino.
  EXECUTE 'DROP TRIGGER IF EXISTS trg_assign_tenant_id ON public.usuarios';
  EXECUTE 'CREATE TRIGGER trg_assign_tenant_id BEFORE INSERT ON public.usuarios '
          'FOR EACH ROW EXECUTE FUNCTION app_assign_tenant_id()';

  -- 2d. Habilitar y FORZAR. El propietario deja de estar exento.
  EXECUTE 'ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.usuarios FORCE  ROW LEVEL SECURITY';

  RAISE NOTICE '068: usuarios asegurada (RLS + FORCE + política usuarios_isolation + trigger)';
END $$;

-- 2e. Arranque de identidad: lecturas que NO pueden tener contexto (login por
--     email, bootstrap por id) se hacen con funciones SECURITY DEFINER. Ejecutan
--     con los privilegios de quien aplica la migración (rol no sujeto a la
--     política de usuarios), de modo que atraviesan RLS de forma deliberada,
--     localizada y auditable — en lugar de dejar la tabla sin proteger.
--     Devuelven SETOF usuarios (o columnas mínimas) para no depender del DDL.
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

-- ---------------------------------------------------------------------------
-- 3. Verificación interna: ninguna tabla puede quedar con RLS activo y sin
--    política, porque eso es denegación total silenciosa.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  sin_politica text;
BEGIN
  SELECT string_agg(c.relname, ', ')
    INTO sin_politica
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
     AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid);

  IF sin_politica IS NOT NULL THEN
    RAISE EXCEPTION
      '068: tablas con RLS activo y SIN políticas (deniegan todo): %. Corrígelo antes de continuar.',
      sin_politica;
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- DESPLIEGUE: rol no propietario (segunda línea de defensa)
-- ============================================================================
-- Con FORCE el propietario ya queda sujeto a las políticas, así que el
-- aislamiento no depende del rol. Aun así, la aplicación debe conectarse con un
-- rol que NO sea propietario ni superusuario: ver
-- backend/scripts/setupRlsRole.sql y backend/scripts/verifyTenantIsolation.js,
-- que prueban ambos caminos (propietario con FORCE y rol no propietario).
-- ============================================================================

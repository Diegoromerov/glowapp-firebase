-- ============================================================================
-- Migración 071: GlowShop A0 — niveles comerciales, catálogo de plataforma y
--                tenencia de todo el comercio.
-- ============================================================================
-- QUÉ HACE (y por qué así)
--   1. Designa un TENANT DE PLATAFORMA. Su dueño es GlowApp, y su catálogo es
--      el que todos los niveles ven. Los administradores pertenecen a ese
--      tenant, de modo que el catálogo global se escribe por la misma vía que
--      la de cualquier negocio: sin BYPASSRLS y sin puertas traseras.
--   2. Añade el PRECIO POR NIVEL como dato: `listas_precios` + `precios_producto`.
--      El precio deja de ser una columna del producto: con tres niveles, dos
--      mínimos de venta y futuras listas negociadas por salón, las columnas no
--      se sostienen.
--   3. Crea `precios_historial`: quién cambió cada precio, cuándo y de dónde
--      vino. Sin eso, una carga masiva de 888 precios es irreversible.
--   4. Da DUEÑO a las tablas del comercio que no lo tenían: `pedidos_tienda`,
--      `detalles_pedido_tienda`, `booking_productos`, `scan_product_matches`,
--      `inventario_consignacion_prestador`.
--   5. Reescribe las políticas del catálogo con la regla Opción A:
--      LEER = lo mío + lo de plataforma · ESCRIBIR = solo lo mío.
--
-- LO QUE NO HACE (a propósito)
--   - No borra datos. Los precios heredados (`precio_al_publico`,
--     `precio_prestador`, `precio_con_reserva`) se conservan intactos: quedan
--     deprecados, y su eliminación va en una migración posterior con informe.
--   - No impone porcentajes. La lista de consumidor se siembra con el precio
--     público actual; profesional y negocio quedan VACÍOS para cargarse a mano
--     (los porcentajes estimados nunca llegan a ser precio real sin decisión).
--   - No mete ningún precio en la misma transacción que crea los valores del
--     enum `tipo_rol` (eso vive en 070).
--
-- SEGURIDAD DE EJECUCIÓN
--   Las escrituras de esta migración ocurren sobre tablas con RLS FORZADO, así
--   que cada bloque que escribe fija su propio contexto de plataforma con
--   set_config local. Aunque el rol de conexión no tenga BYPASSRLS, la
--   migración no se cae: se comporta como un actor legítimo del tenant de
--   plataforma. Y si el rol es propietario, tampoco cambia el resultado.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. El tenant de plataforma
-- ---------------------------------------------------------------------------
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS es_plataforma BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS tenants_unico_plataforma
  ON tenants (es_plataforma) WHERE es_plataforma;

-- Helper: quién es la plataforma. `tenants` no tiene RLS, así que esta función
-- es segura de usar dentro de políticas sin recursión.
CREATE OR REPLACE FUNCTION app_platform_tenant_id() RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT id FROM tenants WHERE es_plataforma ORDER BY id LIMIT 1
$$;

-- ---------------------------------------------------------------------------
-- 2. Designar la plataforma y trasladar el catálogo existente
-- ---------------------------------------------------------------------------
-- Regla: si NO existía tenant de plataforma, el catálogo que ya hay en la base
-- pasa a ser el catálogo de plataforma (es el primer día del modelo). Si YA
-- existía, no se mueve nada y solo se informa, para que el traslado sea una
-- decisión explícita y no un efecto colateral.
DO $$
DECLARE
  plataforma_previa boolean;
  id_plataforma     integer;
  movidos           integer;
  fuera             integer;
BEGIN
  SELECT EXISTS (SELECT 1 FROM tenants WHERE es_plataforma) INTO plataforma_previa;

  IF NOT plataforma_previa THEN
    INSERT INTO tenants (name, slug, es_plataforma)
    VALUES ('GlowApp (Plataforma)', 'glowapp', true)
    ON CONFLICT (slug) DO UPDATE SET es_plataforma = true
    RETURNING id INTO id_plataforma;
  END IF;

  SELECT id INTO id_plataforma FROM tenants WHERE es_plataforma ORDER BY id LIMIT 1;

  IF id_plataforma IS NULL THEN
    RAISE EXCEPTION '071: no se pudo designar un tenant de plataforma.';
  END IF;

  -- Contexto local: permite escribir en el catálogo de plataforma incluso con un
  -- rol de conexión sin BYPASSRLS y con RLS forzado en `productos`.
  PERFORM set_config('app.tenant_id', id_plataforma::text, true);

  IF NOT plataforma_previa THEN
    UPDATE productos SET tenant_id = id_plataforma WHERE tenant_id IS DISTINCT FROM id_plataforma;
    GET DIAGNOSTICS movidos = ROW_COUNT;
    RAISE NOTICE '071: tenant de plataforma creado (id=%). Productos trasladados al catálogo de plataforma: %', id_plataforma, movidos;
  ELSE
    SELECT count(*) INTO fuera FROM productos WHERE tenant_id IS DISTINCT FROM id_plataforma;
    RAISE NOTICE '071: ya existía tenant de plataforma (id=%). Productos que NO son de plataforma: % (no se movió ninguno: el traslado debe decidirse a mano)', id_plataforma, fuera;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Productos: costo, sku y dueño obligatorio
-- ---------------------------------------------------------------------------
-- `costo` (costo de mercancía) es obligatorio para poder medir si un nivel es
-- rentable. La columna queda NULLable porque los productos existentes no lo
-- tienen: la API exigirá costo en el alta y el informe de coherencia señala los
-- que falten (ley de conservación de datos: no se inventa un costo).
ALTER TABLE productos ADD COLUMN IF NOT EXISTS costo NUMERIC(10,2);
ALTER TABLE productos DROP CONSTRAINT IF EXISTS productos_costo_no_negativo;
ALTER TABLE productos ADD CONSTRAINT productos_costo_no_negativo CHECK (costo IS NULL OR costo >= 0);

ALTER TABLE productos ADD COLUMN IF NOT EXISTS sku VARCHAR(40);

DO $$
DECLARE
  huerfanos integer;
BEGIN
  SELECT count(*) INTO huerfanos FROM productos WHERE tenant_id IS NULL;
  IF huerfanos = 0 THEN
    ALTER TABLE productos ALTER COLUMN tenant_id SET NOT NULL;
    RAISE NOTICE '071: productos.tenant_id ahora es NOT NULL.';
  ELSE
    RAISE NOTICE '071: ATENCIÓN — quedan % productos sin tenant_id; NO se aplicó NOT NULL. Ningún producto debe quedar sin dueño: corrígelo y reaplica.', huerfanos;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Precios por nivel: listas, precios y historial
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listas_precios (
  id            SERIAL PRIMARY KEY,
  codigo        VARCHAR(40)  NOT NULL UNIQUE,
  nombre        VARCHAR(120) NOT NULL,
  rol_destino   VARCHAR(20)  NOT NULL CHECK (rol_destino IN ('client', 'provider', 'salon')),
  incluye_iva   BOOLEAN      NOT NULL DEFAULT true,
  vigente_desde DATE         NOT NULL DEFAULT CURRENT_DATE,
  vigente_hasta DATE,
  estado        VARCHAR(20)  NOT NULL DEFAULT 'ACTIVA' CHECK (estado IN ('ACTIVA', 'INACTIVA')),
  tenant_id     INTEGER      NOT NULL REFERENCES tenants(id),
  creado_en     TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS precios_producto (
  lista_id      INTEGER       NOT NULL REFERENCES listas_precios(id) ON DELETE CASCADE,
  producto_id   INTEGER       NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  precio        NUMERIC(10,2) NOT NULL CHECK (precio >= 0),
  unidad_minima INTEGER       NOT NULL DEFAULT 1 CHECK (unidad_minima > 0),
  vigente_desde DATE          NOT NULL DEFAULT CURRENT_DATE,
  vigente_hasta DATE,
  -- Denormalizado a propósito: la política de RLS de esta tabla queda igual de
  -- simple que la de `productos`, sin subconsultas entre tablas con RLS.
  tenant_id     INTEGER       NOT NULL REFERENCES tenants(id),
  PRIMARY KEY (lista_id, producto_id)
);

CREATE TABLE IF NOT EXISTS precios_historial (
  id              SERIAL PRIMARY KEY,
  lista_id        INTEGER       NOT NULL REFERENCES listas_precios(id) ON DELETE CASCADE,
  producto_id     INTEGER       NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  precio_anterior NUMERIC(10,2),
  precio_nuevo    NUMERIC(10,2) NOT NULL,
  actor_id        INTEGER       REFERENCES usuarios(id) ON DELETE SET NULL,
  origen          VARCHAR(30)   NOT NULL CHECK (origen IN ('manual', 'bulk_porcentaje', 'bulk_fijar', 'import_csv', 'migracion')),
  motivo          TEXT,
  creado_en       TIMESTAMPTZ   DEFAULT NOW(),
  tenant_id       INTEGER       NOT NULL REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_precios_producto_tenant    ON precios_producto(tenant_id);
CREATE INDEX IF NOT EXISTS idx_precios_historial_producto ON precios_historial(producto_id, lista_id, creado_en DESC);

-- El tenant_id de un precio debe salir SIEMPRE de su lista: nunca de lo que
-- mande el cliente. SECURITY DEFINER para que el lookup funcione con RLS
-- forzado; la puerta real la cierra la política de la tabla.
CREATE OR REPLACE FUNCTION app_precio_tenant_id() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tenant_lista integer;
BEGIN
  SELECT tenant_id INTO tenant_lista FROM listas_precios WHERE id = NEW.lista_id;
  IF tenant_lista IS NULL THEN
    RAISE EXCEPTION 'El precio apunta a una lista inexistente (lista_id=%).', NEW.lista_id;
  END IF;
  NEW.tenant_id := tenant_lista;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_precio_tenant ON precios_producto;
CREATE TRIGGER trg_precio_tenant BEFORE INSERT OR UPDATE ON precios_producto
  FOR EACH ROW EXECUTE FUNCTION app_precio_tenant_id();

-- ---------------------------------------------------------------------------
-- 5. Semilla de las tres listas + precio de consumidor
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  id_plataforma integer;
  id_cliente    integer;
  sembrados     integer;
BEGIN
  id_plataforma := app_platform_tenant_id();
  PERFORM set_config('app.tenant_id', id_plataforma::text, true);

  -- Los tres niveles acordados. Mínimo de venta: 6 unidades SOLO en el nivel de
  -- salones; consumidor y profesional compran por unidad.
  INSERT INTO listas_precios (codigo, nombre, rol_destino, incluye_iva, tenant_id)
  VALUES
    ('cliente',     'Lista de consumidor final',      'client',   true,  id_plataforma),
    ('profesional', 'Lista de profesionales (reventa)','provider', false, id_plataforma),
    ('negocio',     'Lista mayorista de salones',      'salon',    false, id_plataforma)
  ON CONFLICT (codigo) DO NOTHING;

  SELECT id INTO id_cliente FROM listas_precios WHERE codigo = 'cliente';

  -- El precio de consumidor arranca con el precio público vigente. Los otros dos
  -- niveles NO se siembran: se cargan a mano (dashboard o CSV), sin porcentajes
  -- impuestos por el sistema.
  INSERT INTO precios_producto (lista_id, producto_id, precio, unidad_minima, tenant_id)
  SELECT id_cliente, p.id,
         COALESCE(NULLIF(p.precio_al_publico, 0), p.precio),
         1,
         id_plataforma
    FROM productos p
   WHERE p.tenant_id = id_plataforma
     AND COALESCE(NULLIF(p.precio_al_publico, 0), p.precio) > 0
  ON CONFLICT (lista_id, producto_id) DO NOTHING;

  GET DIAGNOSTICS sembrados = ROW_COUNT;
  RAISE NOTICE '071: listas=3, precios de consumidor sembrados=%, precios de profesional/negocio=0 (se cargan a mano)', sembrados;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Dueño para todo el comercio
-- ---------------------------------------------------------------------------
-- Tablas que hoy NO tienen tenant_id y por tanto no se pueden aislar: se añade,
-- se rellena con lo que se pueda derivar, y solo entonces se fuerza el
-- aislamiento. Nada se borra y nada se inventa: lo que no se pueda derivar
-- queda sin rellenar y se informa.
ALTER TABLE pedidos_tienda                    ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
ALTER TABLE detalles_pedido_tienda            ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
ALTER TABLE booking_productos                 ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
ALTER TABLE scan_product_matches              ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
ALTER TABLE inventario_consignacion_prestador ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);

-- Relleno derivado (sin RLS forzado todavía en estas tablas: 068 no las cubrió).
UPDATE pedidos_tienda p
   SET tenant_id = u.tenant_id
  FROM usuarios u
 WHERE u.id = p.comprador_id AND p.tenant_id IS NULL;

UPDATE detalles_pedido_tienda d
   SET tenant_id = p.tenant_id
  FROM pedidos_tienda p
 WHERE p.id = d.pedido_id AND d.tenant_id IS NULL;

UPDATE booking_productos bp
   SET tenant_id = b.tenant_id
  FROM bookings b
 WHERE b.id = bp.booking_id AND bp.tenant_id IS NULL;

DO $$
DECLARE
  t        text;
  pendientes integer;
  tablas   text[] := ARRAY['pedidos_tienda','detalles_pedido_tienda','booking_productos','scan_product_matches','inventario_consignacion_prestador'];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id IS NULL', t) INTO pendientes;

    IF pendientes = 0 THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id SET NOT NULL', t);
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);

      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I FOR ALL '
        'USING  (tenant_id = app_current_tenant_id()) '
        'WITH CHECK (tenant_id = app_current_tenant_id())', t);

      EXECUTE format('DROP TRIGGER IF EXISTS trg_assign_tenant_id ON %I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_assign_tenant_id BEFORE INSERT ON %I '
        'FOR EACH ROW EXECUTE FUNCTION app_assign_tenant_id()', t);

      RAISE NOTICE '071: % asegurada (tenant_id NOT NULL + RLS forzado + política + trigger)', t;
    ELSE
      RAISE NOTICE '071: ATENCIÓN — % tiene % filas sin tenant_id: NO se forzó el aislamiento. Rellénalas y reaplica.', t, pendientes;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 7. Políticas del catálogo (Opción A)
-- ---------------------------------------------------------------------------
-- LEER  = lo mío + lo de plataforma (el catálogo de GlowApp lo ve todo negocio)
-- ESCRIBIR = solo lo mío (el administrador vive en el tenant de plataforma, así
--            que escribe el catálogo global por esta misma vía, sin BYPASSRLS)
DROP POLICY IF EXISTS tenant_isolation ON productos;

DROP POLICY IF EXISTS productos_lectura ON productos;
CREATE POLICY productos_lectura ON productos FOR SELECT
  USING (tenant_id = app_current_tenant_id() OR tenant_id = app_platform_tenant_id());

DROP POLICY IF EXISTS productos_alta ON productos;
CREATE POLICY productos_alta ON productos FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS productos_edicion ON productos;
CREATE POLICY productos_edicion ON productos FOR UPDATE
  USING      (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS productos_borrado ON productos;
CREATE POLICY productos_borrado ON productos FOR DELETE
  USING (tenant_id = app_current_tenant_id());

-- Mismo patrón para las tres tablas de precios.
DO $$
DECLARE
  t      text;
  tablas text[] := ARRAY['listas_precios', 'precios_producto', 'precios_historial'];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS precios_lectura ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS precios_escritura ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS precios_edicion ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS precios_borrado ON %I', t);

    EXECUTE format(
      'CREATE POLICY precios_lectura ON %I FOR SELECT '
      'USING (tenant_id = app_current_tenant_id() OR tenant_id = app_platform_tenant_id())', t);
    EXECUTE format(
      'CREATE POLICY precios_escritura ON %I FOR INSERT '
      'WITH CHECK (tenant_id = app_current_tenant_id())', t);
    EXECUTE format(
      'CREATE POLICY precios_edicion ON %I FOR UPDATE '
      'USING (tenant_id = app_current_tenant_id()) '
      'WITH CHECK (tenant_id = app_current_tenant_id())', t);
    EXECUTE format(
      'CREATE POLICY precios_borrado ON %I FOR DELETE '
      'USING (tenant_id = app_current_tenant_id())', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 7b. Permisos para los roles de aplicación
-- ---------------------------------------------------------------------------
-- Las tablas nuevas nacen sin permisos para los roles de aplicación. En los
-- entornos donde ya se ejecutó scripts/setupRlsRole.sql existen DEFAULT
-- PRIVILEGES, pero app_system quedó fuera de ellos: se otorga aquí de forma
-- explícita e idempotente. Si el rol no existe en el entorno, se informa y no
-- se falla (los nombres de rol son configuración de despliegue, no esquema).
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['app_rls_user', 'app_system', 'app_runtime_user', 'beauty_app_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON listas_precios, precios_producto, precios_historial TO %I', r);
      EXECUTE format(
        'GRANT USAGE, SELECT ON SEQUENCE listas_precios_id_seq, precios_historial_id_seq TO %I', r);
      RAISE NOTICE '071: permisos de precios otorgados a %', r;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 8. Verificación interna: si algo no cuadra, se cae aquí y no en producción.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n_plataforma integer;
  n_sin_tenant integer;
  n_listas     integer;
  sin_politica text;
BEGIN
  SELECT count(*) INTO n_plataforma FROM tenants WHERE es_plataforma;
  IF n_plataforma <> 1 THEN
    RAISE EXCEPTION '071: debe existir exactamente 1 tenant de plataforma; hay %.', n_plataforma;
  END IF;

  SELECT count(*) INTO n_sin_tenant FROM productos WHERE tenant_id IS NULL;
  IF n_sin_tenant > 0 THEN
    RAISE EXCEPTION '071: hay % productos sin dueño (tenant_id NULL).', n_sin_tenant;
  END IF;

  SELECT count(*) INTO n_listas FROM listas_precios;
  IF n_listas < 3 THEN
    RAISE EXCEPTION '071: se esperaban 3 listas de precios; hay %.', n_listas;
  END IF;

  -- Ninguna tabla con RLS activo puede quedarse sin política: eso es denegación
  -- total silenciosa (misma comprobación que 068).
  SELECT string_agg(c.relname, ', ')
    INTO sin_politica
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
     AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid);
  IF sin_politica IS NOT NULL THEN
    RAISE EXCEPTION '071: tablas con RLS y sin políticas: %.', sin_politica;
  END IF;

  RAISE NOTICE '071: verificación interna OK (1 plataforma, 0 productos sin dueño, % listas).', n_listas;
END $$;

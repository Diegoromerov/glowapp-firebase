-- ============================================================================
-- Migración 121: esquema mínimo de precios del GlowShop
-- ============================================================================
-- POR QUÉ EXISTE
--   `GET /api/products` hace INNER JOIN contra `precios_producto` y
--   `listas_precios`. Esas tablas las crea la 071, que nunca se aplicó en
--   producción: depende de `scan_product_matches` (creada por la 029) y esa
--   tabla tampoco existe. Por eso el endpoint respondía
--   `relation "precios_producto" does not exist` → HTTP 500 y la tienda vacía.
--
--   La 071 completa no se puede aplicar todavía (necesita 029 y el resto de la
--   refactorización biométrica). Esta migración crea SOLO lo que la tienda
--   necesita para funcionar, con las mismas definiciones que la 071.
--
-- LO QUE HACE
--   1. Agrega `tenants.es_plataforma`, columna que introduce la 071.
--   2. Crea `listas_precios`, `precios_producto` y `precios_historial`.
--   3. Siembra las tres listas base con los códigos que usa `precioService`:
--      `cliente`, `profesional`, `negocio`.
--   4. Copia a la lista `cliente` los precios que ya existen en la columna
--      deprecada `productos.precio`, para que la tienda no arranque vacía.
--
-- LO QUE NO HACE
--   - No modifica `productos`, ni borra datos, ni toca `scan_product_matches`.
--   - No enciende RLS: lo hace la 120, que recorre cada tabla con `tenant_id`,
--     y esta migración se aplica después de ella en la lista del arranque.
--
-- IDEMPOTENCIA
--   Todo con IF NOT EXISTS / ON CONFLICT. Se reejecuta en cada deploy sin efecto.
-- ============================================================================

BEGIN;

-- 1. Columna de plataforma (la introduce 071, que no se aplicó)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS es_plataforma BOOLEAN NOT NULL DEFAULT false;

-- 2. Tablas del modelo de precios (definiciones copiadas de 071)
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

-- 3. Listas base. El tenant dueño es el de plataforma si existe; si no, el
--    primero de la tabla (no se crea ningún tenant: los datos son sagrados).
INSERT INTO listas_precios (codigo, nombre, rol_destino, tenant_id)
SELECT v.codigo, v.nombre, v.rol_destino, t.id
FROM (
  VALUES
    ('cliente',     'Lista Cliente',     'client'),
    ('profesional', 'Lista Profesional', 'provider'),
    ('negocio',     'Lista Negocio',     'salon')
) AS v(codigo, nombre, rol_destino)
CROSS JOIN (
  SELECT id FROM tenants ORDER BY es_plataforma DESC, id ASC LIMIT 1
) AS t
ON CONFLICT (codigo) DO NOTHING;

-- 4. Precios iniciales desde la columna deprecada `precios_producto`
--    (la columna `productos.precio` existe y el catálogo tiene 16 productos).
INSERT INTO precios_producto (lista_id, producto_id, precio, tenant_id)
SELECT lp.id, p.id, p.precio, lp.tenant_id
FROM productos p
JOIN listas_precios lp ON lp.codigo = 'cliente'
WHERE p.precio IS NOT NULL
  AND p.precio > 0
ON CONFLICT (lista_id, producto_id) DO NOTHING;

-- 5. Autoverificación: si algo no quedó, que falle aquí y no en la tienda
DO $$
DECLARE
  v_listas  integer;
  v_precios integer;
BEGIN
  SELECT count(*) INTO v_listas FROM listas_precios WHERE codigo IN ('cliente', 'profesional', 'negocio');
  IF v_listas < 3 THEN
    RAISE EXCEPTION '121: faltan listas base (encontradas: %)', v_listas;
  END IF;

  SELECT count(*) INTO v_precios FROM precios_producto;
  RAISE NOTICE '121: % listas base, % precios cargados en precios_producto', v_listas, v_precios;
END $$;

COMMIT;

-- ============================================================================
-- Migración 123: desbloquea el checkout de la tienda (ciclo Wompi)
-- ============================================================================
-- POR QUÉ EXISTE
--   `orderController.createOrder` consulta `app_platform_tenant_id()` y escribe
--   `tenant_id` en `pedidos_tienda` y `detalles_pedido_tienda`. Todo eso lo
--   introduce la 071, que nunca se aplicó (depende de `scan_product_matches`).
--   Resultado en producción, comprobado:
--     - function app_platform_tenant_id() does not exist
--     - pedidos_tienda.tenant_id          NO existe
--     - detalles_pedido_tienda.tenant_id  NO existe
--   La primera consulta revienta, así que el pedido nunca se crea y la app
--   recibe `500 {"error":"Error al procesar el checkout"}`. Sin pedido no hay
--   pago: el ciclo de Wompi no puede ni empezar.
--
-- LO QUE HACE
--   1. Crea `app_platform_tenant_id()` tal cual la define la 071.
--   2. Designa tenant de plataforma si no hay ninguno. Sin esto la función
--      devuelve NULL y `createOrder` corta con 409. Se marca el tenant de menor
--      id porque es el dueño de las listas de precios que sembró la 121.
--   3. Añade `tenant_id` (nullable, FK a tenants) a pedidos_tienda,
--      detalles_pedido_tienda, booking_productos e inventario_consignacion_prestador,
--      igual que la 071.
--
-- LO QUE NO HACE
--   - No fuerza NOT NULL ni RLS: eso lo hace la 120, que recorre cada tabla con
--     `tenant_id` en el siguiente arranque.
--   - No crea tenants ni borra datos. `pedidos_tienda`, `detalles_pedido_tienda`,
--     `booking_productos` e `inventario_consignacion_prestador` están vacías.
--
-- IDEMPOTENCIA
--   CREATE OR REPLACE / IF NOT EXISTS / guardas. Se reejecuta sin efecto.
-- ============================================================================

BEGIN;

-- 1. Función de tenant de plataforma (definición literal de la 071)
CREATE OR REPLACE FUNCTION app_platform_tenant_id() RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT id FROM tenants WHERE es_plataforma ORDER BY id LIMIT 1
$$;

-- 2. Garantizar que exista un tenant de plataforma
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE es_plataforma) THEN
    UPDATE tenants SET es_plataforma = true
     WHERE id = (SELECT min(id) FROM tenants);
    RAISE NOTICE '123: no había tenant de plataforma; marcado el de menor id';
  END IF;
END $$;

-- 3. Columnas tenant_id que espera el checkout
-- Cada ALTER está guardado por to_regclass: si la tabla no existe en este
-- entorno (p.ej. CI sin el esquema GlowShop), la migración avanza dejando
-- NOTICE en vez de fallar. En producción todas existen y se aplican completo.
DO $$
BEGIN
  IF to_regclass('public.pedidos_tienda') IS NOT NULL THEN
    ALTER TABLE pedidos_tienda ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
    CREATE INDEX IF NOT EXISTS idx_pedidos_tienda_tenant ON pedidos_tienda(tenant_id);
  ELSE
    RAISE NOTICE '123: pedidos_tienda no existe en este entorno: se omite el ADD COLUMN';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.detalles_pedido_tienda') IS NOT NULL THEN
    ALTER TABLE detalles_pedido_tienda ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
    CREATE INDEX IF NOT EXISTS idx_detalles_pedido_tenant ON detalles_pedido_tienda(tenant_id);
  ELSE
    RAISE NOTICE '123: detalles_pedido_tienda no existe en este entorno: se omite el ADD COLUMN';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.booking_productos') IS NOT NULL THEN
    ALTER TABLE booking_productos ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
  ELSE
    RAISE NOTICE '123: booking_productos no existe en este entorno: se omite el ADD COLUMN';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.inventario_consignacion_prestador') IS NOT NULL THEN
    ALTER TABLE inventario_consignacion_prestador ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
  ELSE
    RAISE NOTICE '123: inventario_consignacion_prestador no existe en este entorno: se omite el ADD COLUMN';
  END IF;
END $$;

-- 4. Autoverificación
DO $$
DECLARE
  v_tenant integer;
  v_cols   integer;
BEGIN
  v_tenant := app_platform_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION '123: app_platform_tenant_id() sigue devolviendo NULL';
  END IF;

  SELECT count(*) INTO v_cols
  FROM information_schema.columns
  WHERE column_name = 'tenant_id'
    AND table_name IN ('pedidos_tienda','detalles_pedido_tienda',
                       'booking_productos','inventario_consignacion_prestador');

  IF v_cols <> 4 THEN
    RAISE EXCEPTION '123: faltan columnas tenant_id (encontradas: %)', v_cols;
  END IF;

  RAISE NOTICE '123: tenant de plataforma = %; columnas tenant_id = 4', v_tenant;
END $$;

COMMIT;

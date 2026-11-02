-- Semilla mínima para el arnés E2E en CI.
--
-- El arnés verifica reglas del dinero (split, propina, cancelación, envío, IVA).
-- Sin catálogo, esos bloques salen como OMITIDOS y un omitido no es una regla
-- verificada. Esta semilla no pretende parecerse al catálogo real: pone lo
-- mínimo para que cada umbral se pueda cruzar con stock de verdad.
--
--   90.000 x 4 = 360.000  cruza el umbral de Bogotá (300.000)
--   90.000 x 6 = 540.000  cruza el umbral nacional (480.000)
--   45.000                canasta por debajo del piso de envío gratis
--
-- Idempotente: borra los productos de prueba y los vuelve a crear.

-- El esquema viene de `schema-base.sql` (volcado estructural, sin datos), así
-- que aquí también se crean el inquilino de plataforma y las zonas, que en
-- producción ya existen.
DO $$
DECLARE
  tenant_plataforma integer;
  lista_cliente     integer;
BEGIN
  ---------------------------------------------------------------- inquilino
  SELECT id INTO tenant_plataforma FROM tenants WHERE es_plataforma ORDER BY id LIMIT 1;
  IF tenant_plataforma IS NULL THEN
    INSERT INTO tenants (name, slug, es_plataforma)
    VALUES ('GlowApp (CI)', 'glowapp-ci', true)
    RETURNING id INTO tenant_plataforma;
  END IF;

  ------------------------------------------------------------------- zonas
  -- Umbrales de D-GL-011 v2. Solo dos: el arnés compara Bogotá contra 300.000
  -- y Cali contra 480.000.
  INSERT INTO zonas_envio (ciudad, departamento, tarifa_base, tarifa_por_kg,
                           gratis_desde_monto, transportadora_default, activa)
  SELECT 'Bogotá', 'Cundinamarca', 7900, 3800, 300000, 'interrapidisimo', true
   WHERE NOT EXISTS (SELECT 1 FROM zonas_envio WHERE ciudad = 'Bogotá');
  INSERT INTO zonas_envio (ciudad, departamento, tarifa_base, tarifa_por_kg,
                           gratis_desde_monto, transportadora_default, activa)
  SELECT 'Cali', 'Valle del Cauca', 15900, 4200, 480000, 'interrapidisimo', true
   WHERE NOT EXISTS (SELECT 1 FROM zonas_envio WHERE ciudad = 'Cali');

  ------------------------------------------------------------ lista de precios
  SELECT id INTO lista_cliente FROM listas_precios WHERE codigo = 'cliente' LIMIT 1;
  IF lista_cliente IS NULL THEN
    INSERT INTO listas_precios (codigo, nombre, rol_destino, incluye_iva, estado, tenant_id)
    VALUES ('cliente', 'Lista cliente', 'client', true, 'ACTIVA', tenant_plataforma)
    RETURNING id INTO lista_cliente;
  ELSE
    UPDATE listas_precios
       SET incluye_iva = true, estado = 'ACTIVA', tenant_id = tenant_plataforma
     WHERE id = lista_cliente;
  END IF;

  ------------------------------------------------------------------ catálogo
  DELETE FROM productos WHERE nombre LIKE 'E2E %';

  INSERT INTO productos (nombre, descripcion, precio, stock, tipo_visibilidad,
                         precio_al_publico, sku, tenant_id, tag_especialidad)
  VALUES ('E2E Producto A', 'semilla del arnés',  90000, 40, 'PUBLICO',  90000, 'E2E-A', tenant_plataforma, 'cabello'),
         ('E2E Producto B', 'semilla del arnés',  45000, 40, 'PUBLICO',  45000, 'E2E-B', tenant_plataforma, 'cabello'),
         ('E2E Producto C', 'semilla del arnés', 120000, 20, 'PUBLICO', 120000, 'E2E-C', tenant_plataforma, 'cabello');

  INSERT INTO precios_producto (lista_id, producto_id, precio, vigente_desde)
  SELECT lista_cliente, p.id, p.precio_al_publico, NOW() - INTERVAL '1 day'
    FROM productos p
   WHERE p.nombre LIKE 'E2E %';
END $$;

-- Comprobación: si la semilla no quedó, que falle aquí y no tres pasos después.
DO $$
DECLARE n int; z int;
BEGIN
  SELECT count(*) INTO n
    FROM precios_producto pr
    JOIN productos p ON p.id = pr.producto_id
   WHERE p.nombre LIKE 'E2E %';
  IF n < 3 THEN
    RAISE EXCEPTION 'semilla E2E incompleta: % precios', n;
  END IF;

  SELECT count(*) INTO z FROM zonas_envio WHERE gratis_desde_monto IN (300000, 480000);
  IF z < 2 THEN
    RAISE EXCEPTION 'semilla E2E incompleta: faltan zonas con umbral (hay %)', z;
  END IF;
END $$;

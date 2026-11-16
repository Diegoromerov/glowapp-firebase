-- Migración 169: Saneamiento de datos sembrados por migraciones no idempotentes
--
-- QUÉ REPARA
-- ----------
-- Las versiones anteriores de 166 y 094 se re-ejecutaban en cada arranque sin
-- guardas efectivas:
--   · 166 insertaba los 21 insumos B2B con "ON CONFLICT DO NOTHING", pero
--     productos no tiene UNIQUE(nombre): el conflicto nunca ocurría y cada
--     despliegue añadía otra copia (staging llegó a 530 filas para 23 nombres).
--   · 094 sembraba zonas_envio con "ON CONFLICT (ciudad, departamento,
--     codigo_postal_prefijo)": con codigo_postal_prefijo NULL ('OTRO') el
--     índice único no protege, así que cada arranque añadía otro 'OTRO'
--     (staging llegó a 12), y el cotizador elegía uno al azar.
--
-- IDEMPOTENTE: si no hay duplicados no hace nada. Corre en el arranque.
-- Va después de 166/167/168 porque consume su mapeo.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Zonas de envío: colapsar duplicados a una sola fila por ciudad
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r record;
  v_keeper UUID;
BEGIN
  FOR r IN
    SELECT ciudad, departamento, codigo_postal_prefijo
      FROM zonas_envio
     GROUP BY 1, 2, 3
    HAVING count(*) > 1
  LOOP
    -- Keeper: la zona que ya está referenciada (municipios o reglas de routing);
    -- si ninguna lo está, la más antigua.
    SELECT z.id INTO v_keeper
      FROM zonas_envio z
     WHERE z.ciudad = r.ciudad
       AND z.departamento = r.departamento
       AND z.codigo_postal_prefijo IS NOT DISTINCT FROM r.codigo_postal_prefijo
     ORDER BY (EXISTS (SELECT 1 FROM municipios_dane m WHERE m.zona_envio_id = z.id)) DESC,
              (EXISTS (SELECT 1 FROM shipping_routing_rules s WHERE s.zona_id = z.id)) DESC,
              z.creado_en ASC, z.id ASC
     LIMIT 1;

    UPDATE municipios_dane SET zona_envio_id = v_keeper
     WHERE zona_envio_id IN (
       SELECT id FROM zonas_envio
        WHERE ciudad = r.ciudad AND departamento = r.departamento
          AND codigo_postal_prefijo IS NOT DISTINCT FROM r.codigo_postal_prefijo
          AND id <> v_keeper);

    UPDATE shipping_routing_rules SET zona_id = v_keeper
     WHERE zona_id IN (
       SELECT id FROM zonas_envio
        WHERE ciudad = r.ciudad AND departamento = r.departamento
          AND codigo_postal_prefijo IS NOT DISTINCT FROM r.codigo_postal_prefijo
          AND id <> v_keeper);

    DELETE FROM zonas_envio
     WHERE ciudad = r.ciudad AND departamento = r.departamento
       AND codigo_postal_prefijo IS NOT DISTINCT FROM r.codigo_postal_prefijo
       AND id <> v_keeper;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Zona para los municipios DANE que quedaron sin tarifa
-- ─────────────────────────────────────────────────────────────────────────────
-- 167 vincula por nombre; los que no tienen zona en 094 (Cúcuta, Tunja,
-- Popayán, Yopal, ...) quedaban en NULL y caían al fallback silencioso.
INSERT INTO zonas_envio (ciudad, departamento, codigo_postal_prefijo, tarifa_base, tarifa_por_kg,
                         gratis_desde_monto, transportadora_default, dias_estimados_min, dias_estimados_max)
SELECT DISTINCT m.nombre, m.departamento_nombre, NULL, 15000.00, 800.00, 480000.00, 'Coordinadora', 3, 6
  FROM municipios_dane m
 WHERE m.zona_envio_id IS NULL
   AND m.dane_code <> '99999'
   AND NOT EXISTS (
     SELECT 1 FROM zonas_envio z
      WHERE lower(translate(z.ciudad, 'áéíóúüñ', 'aeiouun')) = lower(translate(m.nombre, 'áéíóúüñ', 'aeiouun'))
        AND lower(translate(z.departamento, 'áéíóúüñ', 'aeiouun')) = lower(translate(m.departamento_nombre, 'áéíóúüñ', 'aeiouun')));

UPDATE municipios_dane m
   SET zona_envio_id = z.id
  FROM zonas_envio z
 WHERE m.zona_envio_id IS NULL
   AND m.dane_code <> '99999'
   AND lower(translate(z.ciudad, 'áéíóúüñ', 'aeiouun')) = lower(translate(m.nombre, 'áéíóúüñ', 'aeiouun'))
   AND lower(translate(z.departamento, 'áéíóúüñ', 'aeiouun')) = lower(translate(m.departamento_nombre, 'áéíóúüñ', 'aeiouun'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Productos B2B: colapsar duplicados por nombre
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _dup_b2b (dup_id INTEGER, keeper_id INTEGER) ON COMMIT DROP;

INSERT INTO _dup_b2b (dup_id, keeper_id)
SELECT p.id,
       (SELECT p2.id FROM productos p2
         WHERE p2.nombre = p.nombre
           AND p2.tipo_visibilidad = 'INSUMO_PRESTADOR'
         ORDER BY p2.id ASC LIMIT 1)
  FROM productos p
 WHERE p.tipo_visibilidad = 'INSUMO_PRESTADOR'
   AND p.id <> (SELECT p2.id FROM productos p2
                 WHERE p2.nombre = p.nombre
                   AND p2.tipo_visibilidad = 'INSUMO_PRESTADOR'
                 ORDER BY p2.id ASC LIMIT 1);

-- Repuntar TODAS las FK que apuntan a productos antes de borrar.
UPDATE detalles_pedido_tienda d SET producto_id = k.keeper_id
  FROM _dup_b2b k WHERE d.producto_id = k.dup_id;

UPDATE booking_productos b SET producto_id = k.keeper_id
  FROM _dup_b2b k WHERE b.producto_id = k.dup_id;

UPDATE inventario_consignacion_prestador i SET producto_id = k.keeper_id
  FROM _dup_b2b k WHERE i.producto_id = k.dup_id;

UPDATE precios_historial h SET producto_id = k.keeper_id
  FROM _dup_b2b k WHERE h.producto_id = k.dup_id;

UPDATE devoluciones dv SET producto_cambio_id = k.keeper_id
  FROM _dup_b2b k WHERE dv.producto_cambio_id = k.dup_id;

-- Precios: se descartan los del duplicado (si el keeper ya tiene precio en esa
-- lista, reinsertarlos violaría el único (lista, producto)); se reponen abajo.
DELETE FROM precios_producto pp USING _dup_b2b k WHERE pp.producto_id = k.dup_id;

DELETE FROM productos p USING _dup_b2b k WHERE p.id = k.dup_id;

-- Reponer precios faltantes del keeper en profesional (u.min 1) y negocio (u.min 6).
INSERT INTO precios_producto (lista_id, producto_id, precio, unidad_minima, tenant_id)
SELECT l.id, p.id, p.precio_prestador, 1, p.tenant_id
  FROM productos p
  JOIN listas_precios l ON l.codigo = 'profesional' AND l.tenant_id = p.tenant_id
 WHERE p.tipo_visibilidad = 'INSUMO_PRESTADOR'
   AND NOT EXISTS (SELECT 1 FROM precios_producto pp WHERE pp.lista_id = l.id AND pp.producto_id = p.id);

INSERT INTO precios_producto (lista_id, producto_id, precio, unidad_minima, tenant_id)
SELECT l.id, p.id, p.precio_prestador, 6, p.tenant_id
  FROM productos p
  JOIN listas_precios l ON l.codigo = 'negocio' AND l.tenant_id = p.tenant_id
 WHERE p.tipo_visibilidad = 'INSUMO_PRESTADOR'
   AND NOT EXISTS (SELECT 1 FROM precios_producto pp WHERE pp.lista_id = l.id AND pp.producto_id = p.id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Blindaje: que las dos fuentes del desastre no puedan repetirse
-- ─────────────────────────────────────────────────────────────────────────────
-- Índice parcial en lugar de UNIQUE global: dos proveedores distintos sí pueden
-- vender un insumo con el mismo nombre; el catálogo de plataforma, no duplicarlo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_zonas_envio_ciudad_depto
  ON zonas_envio (ciudad, departamento)
  WHERE codigo_postal_prefijo IS NULL;

COMMIT;

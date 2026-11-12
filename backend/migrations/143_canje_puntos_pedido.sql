-- 143_canje_puntos_pedido.sql
--
-- El descuento por puntos tiene que quedar ESCRITO en el pedido.
--
-- Hallazgo A1: `pedidos_tienda` nace en la 010 sin columna `descuento`, y sin
-- embargo `generarFacturaDianPedido` la lee (`orderController.js:1140`) con un
-- `|| 0` que la convierte en cero sin error. Es decir: hasta hoy la factura
-- declara «sin descuentos» siempre, aunque el cliente hubiera pagado menos.
--
-- Se añaden dos columnas aditivas con default 0, así que los pedidos existentes
-- quedan válidos sin reescribir nada:
--
--   descuento          pesos descontados (productos, nunca envío)
--   puntos_canjeados   puntos del libro que se aplicaron a este pedido
--
-- `puntos_canjeados` es también la guarda del doble canje: el pedido nace con su
-- cifra y no se vuelve a canjear sobre él (409 en el endpoint).

ALTER TABLE pedidos_tienda
  ADD COLUMN IF NOT EXISTS descuento NUMERIC(10,2) NOT NULL DEFAULT 0;

ALTER TABLE pedidos_tienda
  ADD COLUMN IF NOT EXISTS puntos_canjeados INTEGER NOT NULL DEFAULT 0;

-- Una restricción con nombre fijo, añadida sólo si no existe: `ALTER TABLE ... ADD
-- CONSTRAINT` no admite IF NOT EXISTS y re-ejecutarla rompería el arranque.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pedidos_tienda_canje_coherente'
       AND conrelid = 'pedidos_tienda'::regclass
  ) THEN
    ALTER TABLE pedidos_tienda
      ADD CONSTRAINT pedidos_tienda_canje_coherente
      CHECK (descuento >= 0 AND puntos_canjeados >= 0);
  END IF;
END $$;

-- El descuento se aplica sobre el valor de los productos con IVA incluido, así
-- que nunca puede superar `subtotal + iva`. Con el tope del 15% esta condición se
-- cumple siempre; se deja en la base para que un bug futuro no la pueda saltar.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pedidos_tienda_descuento_no_supera_productos'
       AND conrelid = 'pedidos_tienda'::regclass
  ) THEN
    ALTER TABLE pedidos_tienda
      ADD CONSTRAINT pedidos_tienda_descuento_no_supera_productos
      CHECK (descuento <= subtotal + iva);
  END IF;
END $$;

COMMENT ON COLUMN pedidos_tienda.descuento IS
  'Descuento en pesos aplicado por canje de puntos (sólo productos, no envío)';
COMMENT ON COLUMN pedidos_tienda.puntos_canjeados IS
  'Puntos del libro (points_lots) aplicados a este pedido; 0 si no usó puntos';

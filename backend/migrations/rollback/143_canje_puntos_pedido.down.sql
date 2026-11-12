-- rollback/143_canje_puntos_pedido.down.sql
--
-- Reversa de 143. Quita las columnas del canje y sus restricciones.
-- Los puntos comprometidos en pedidos NO se devuelven solos: si se baja esta
-- migración con pedidos ya pagados usando puntos, el saldo queda descontado.
-- Por eso 143 sólo se baja antes de abrir el canje en producción.

ALTER TABLE pedidos_tienda DROP CONSTRAINT IF EXISTS pedidos_tienda_descuento_no_supera_productos;
ALTER TABLE pedidos_tienda DROP CONSTRAINT IF EXISTS pedidos_tienda_canje_coherente;
ALTER TABLE pedidos_tienda DROP COLUMN IF EXISTS puntos_canjeados;
ALTER TABLE pedidos_tienda DROP COLUMN IF EXISTS descuento;

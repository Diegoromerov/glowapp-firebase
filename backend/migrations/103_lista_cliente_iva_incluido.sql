-- ─────────────────────────────────────────────────────────────────────────────
-- D-GL-023, regla 8: los precios exhibidos llevan IVA incluido.
--
-- La lista `cliente` estaba marcada con `incluye_iva = false`, así que el
-- checkout trataba el precio de vitrina como base y le sumaba 19 % encima.
-- Medido en producción: 75.000 de mercancía + 10.200 de envío se cobraban
-- como 99.450, cuando el precio que el comprador ve es 75.000 y el total
-- correcto es 85.200. Son 14.250 de IVA duplicado en cada pedido, un 16,7 %
-- sobre lo que la regla permite.
--
-- `orderController` ya discrimina con `discriminarIva()` cuando la lista
-- declara IVA incluido: no hay cambio de código, el defecto era de datos.
--
-- Las listas `profesional` y `negocio` son de reventa y se dejan intactas.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE listas_precios
   SET incluye_iva = true
 WHERE codigo = 'cliente'
   AND rol_destino = 'client'
   AND incluye_iva = false;

-- Verificación: debe devolver una sola fila con incluye_iva = true.
--   SELECT codigo, incluye_iva FROM listas_precios WHERE codigo = 'cliente';

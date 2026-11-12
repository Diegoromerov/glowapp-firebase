// src/config/programaPuntos.js
//
// Los números del programa en un solo lugar. Se separan del servicio para que la
// regla de negocio se lea sin abrir la implementación, y para que el día que el
// Director cambie el tope o el mínimo haya UN archivo que tocar.
//
// Aprobados el 2026-11-12 (D-04, D-06, D-10):
//   1 punto = $10 COP · canje en bloques de 100 ($1.000)
//   tope de canje: 15% del valor de los productos con IVA incluido
//   pedido mínimo para canjear: $25.000 de productos
//   vencimiento: 12 meses por lote
//
// El porqué del 15% y no del 20% está en la §6 del documento de arquitectura:
// con IVA incluido y costo al 65% de la lista, cada peso de descuento cuesta
// $0,84 de margen, y el 20% dejaba el pedido con 2,2%.
const VALOR_PUNTO_COP = 10;
const BLOQUE_CANJE = 100;
const TOPE_PORCENTAJE = 15;
const MINIMO_PEDIDO = 25000;
const MESES_VIGENCIA = 12;

/// Compra mínima de productos para que la conversión premie (R-06 del documento
/// de arquitectura). Sin esto, fabricar conversiones con el producto más barato
/// del catálogo sale gratis.
const MINIMO_COMPRA_PREMIO = 20000;

module.exports = {
  VALOR_PUNTO_COP,
  BLOQUE_CANJE,
  TOPE_PORCENTAJE,
  MINIMO_PEDIDO,
  MESES_VIGENCIA,
  MINIMO_COMPRA_PREMIO,
};

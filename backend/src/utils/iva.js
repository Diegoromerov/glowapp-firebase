'use strict';

/**
 * Discriminación del IVA en un precio que ya lo incluye.
 *
 * Base legal: el artículo 476, numeral 1, literal a) del Estatuto Tributario
 * exceptúa del listado de servicios excluidos a "los tratamientos de belleza",
 * de modo que están gravados a la tarifa general del 19% (art. 468 E.T.). Pero
 * el precio que el prestador publica es el precio FINAL al consumidor y el
 * Estatuto del Consumidor exige que el precio exhibido incluya los impuestos:
 * por eso el IVA se DISCRIMINA del total en lugar de sumársele. La reserva
 * conserva el precio que el cliente vio, y lo que queda separado es la base
 * gravable que la factura necesita.
 *
 * `tarifaIva = 0` no es un caso de error: es el prestador que no es responsable
 * de IVA (art. 437, parágrafo 3, E.T.), y entonces todo el total es base.
 *
 * Devuelve enteros en pesos: la plataforma maneja montos sin decimales (ver
 * `utils/money.js`), y `subtotalBase + ivaValor === total` se cumple siempre,
 * que es lo que la factura necesita para cuadrar.
 *
 * @param {number|string} totalAmount Precio final al consumidor, IVA incluido.
 * @param {number|string} tarifaIva    Tarifa aplicable (0.19 para la general).
 * @returns {{subtotalBase: number, ivaValor: number, tarifaAplicada: number}}
 */
function discriminarIva(totalAmount, tarifaIva) {
  const total = Number(totalAmount);
  if (!Number.isFinite(total) || total < 0) {
    throw new Error('El monto total debe ser un número finito no negativo.');
  }

  const tarifa = Number(tarifaIva);
  if (!Number.isFinite(tarifa) || tarifa < 0 || tarifa > 1) {
    throw new Error('La tarifa de IVA debe ser un número entre 0 y 1.');
  }

  if (tarifa === 0) {
    return { subtotalBase: total, ivaValor: 0, tarifaAplicada: 0 };
  }

  const ivaValor = Math.round(total - total / (1 + tarifa));
  return { subtotalBase: total - ivaValor, ivaValor, tarifaAplicada: tarifa };
}

module.exports = { discriminarIva };

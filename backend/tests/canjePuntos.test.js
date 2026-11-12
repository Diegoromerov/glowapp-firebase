// backend/tests/canjePuntos.test.js
//
// La aritmética del canje, aislada de la base y del pedido. Es donde viven los
// errores caros: un tope mal medido, un bloque mal redondeado o un pedido mínimo
// que no se respeta se traducen en pesos regalados.
//
// Reglas citadas del documento de arquitectura: R-08 (tope 15%), R-09 (bloques de
// 100), R-10 (mínimo $25.000).
jest.mock('../src/config/db', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));

const { calcularCanjePuntos } = require('../src/controllers/orderController');

describe('calcularCanjePuntos', () => {
  test('sin puntos pedidos no hay descuento', () => {
    expect(calcularCanjePuntos({ puntosSolicitados: 0, totalProductos: 50000 })).toEqual({
      puntosAplicados: 0,
      descuento: 0,
    });
    expect(calcularCanjePuntos({ totalProductos: 50000 })).toEqual({
      puntosAplicados: 0,
      descuento: 0,
    });
  });

  test('500 puntos en un pedido de $50.000 entran completos ($5.000 = 10%)', () => {
    expect(calcularCanjePuntos({ puntosSolicitados: 500, totalProductos: 50000 })).toEqual({
      puntosAplicados: 500,
      descuento: 5000,
    });
  });

  test('el tope del 15% recorta: en $25.000 sólo caben 300 puntos', () => {
    // 15% de 25.000 = 3.750 -> 375 puntos -> se baja al bloque de 100
    expect(calcularCanjePuntos({ puntosSolicitados: 500, totalProductos: 25000 })).toEqual({
      puntosAplicados: 300,
      descuento: 3000,
    });
  });

  test('desde $33.334 un premio de 500 puntos entra completo', () => {
    expect(calcularCanjePuntos({ puntosSolicitados: 500, totalProductos: 33334 })).toEqual({
      puntosAplicados: 500,
      descuento: 5000,
    });
    // Un peso menos y ya no cabe entero.
    expect(calcularCanjePuntos({ puntosSolicitados: 500, totalProductos: 33333 })).toEqual({
      puntosAplicados: 400,
      descuento: 4000,
    });
  });

  test('lo pedido se baja al bloque de 100, nunca se redondea hacia arriba', () => {
    expect(calcularCanjePuntos({ puntosSolicitados: 150, totalProductos: 50000 })).toEqual({
      puntosAplicados: 100,
      descuento: 1000,
    });
  });

  test('por debajo del mínimo de $25.000 el canje se rechaza con motivo', () => {
    expect(() =>
      calcularCanjePuntos({ puntosSolicitados: 100, totalProductos: 20000 })
    ).toThrow(/pedido mínimo/i);
    expect(() =>
      calcularCanjePuntos({ puntosSolicitados: 100, totalProductos: 20000 })
    ).toThrow(expect.objectContaining({ code: 'PEDIDO_MINIMO' }));
  });

  test('nunca entrega más del 15% del valor de los productos', () => {
    for (const total of [25000, 33333, 50000, 89000]) {
      const { descuento } = calcularCanjePuntos({ puntosSolicitados: 999900, totalProductos: total });
      expect(descuento).toBeLessThanOrEqual(Math.floor(total * 0.15));
      expect(descuento % 1000).toBe(0);
    }
  });

  test('puntos inválidos fallan en vez de colarse como cero', () => {
    expect(() => calcularCanjePuntos({ puntosSolicitados: -100, totalProductos: 50000 })).toThrow(
      expect.objectContaining({ code: 'PUNTOS_INVALIDOS' })
    );
    expect(() => calcularCanjePuntos({ puntosSolicitados: 12.5, totalProductos: 50000 })).toThrow(
      expect.objectContaining({ code: 'PUNTOS_INVALIDOS' })
    );
  });
});

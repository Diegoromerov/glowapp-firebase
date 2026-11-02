'use strict';

/**
 * IVA — art. 476 num. 1 lit. a) del Estatuto Tributario: los tratamientos de
 * belleza están EXCLUIDOS de la exclusión, o sea gravados a la tarifa general.
 *
 * Esta prueba fija lo que no puede cambiar sin cambiar la ley o el precio que ve
 * el cliente:
 *   1. `subtotalBase + ivaValor === total` SIEMPRE (si no cuadra, la factura no
 *      cuadra y se está cobrando de más o de menos).
 *   2. El precio al consumidor NO cambia: el IVA se separa, no se suma.
 *   3. Un prestador no responsable de IVA (art. 437 par. 3 E.T.) no causa IVA.
 */
const { discriminarIva } = require('../utils/iva');

describe('IVA — discriminación del precio final (no se suma)', () => {
  test('la tarifa general discrimina exactamente sobre un total redondo', () => {
    const r = discriminarIva(119000, 0.19);

    expect(r.subtotalBase).toBe(100000);
    expect(r.ivaValor).toBe(19000);
    expect(r.tarifaAplicada).toBe(0.19);
  });

  test('con un total que no es múltiplo exacto, base + IVA sigue cuadrando con el total', () => {
    const r = discriminarIva(100000, 0.19);

    expect(r.ivaValor).toBe(15966);
    expect(r.subtotalBase).toBe(84034);
    // El invariante que importa: no se pierde ni se inventa un peso.
    expect(r.subtotalBase + r.ivaValor).toBe(100000);
  });

  test('el precio al consumidor NO sube: 119.000 con IVA sigue siendo 119.000', () => {
    const sinIva = discriminarIva(119000, 0);
    const conIva = discriminarIva(119000, 0.19);

    expect(conIva.subtotalBase + conIva.ivaValor).toBe(119000);
    expect(conIva.subtotalBase + conIva.ivaValor).toBe(
      sinIva.subtotalBase + sinIva.ivaValor
    );
  });

  test('un prestador NO responsable de IVA no causa IVA: todo el total es base', () => {
    const r = discriminarIva(150000, 0);

    expect(r.ivaValor).toBe(0);
    expect(r.subtotalBase).toBe(150000);
    expect(r.tarifaAplicada).toBe(0);
  });

  test('acepta los montos como los devuelve PostgreSQL (string numérico)', () => {
    const r = discriminarIva('238000.00', '0.1900');

    expect(r.subtotalBase + r.ivaValor).toBe(238000);
    expect(r.ivaValor).toBe(38000);
  });

  test('cuadra para cualquier total razonable (barrido)', () => {
    for (let total = 1; total <= 2000; total += 7) {
      const r = discriminarIva(total, 0.19);
      // El invariante que sostiene la factura: nunca se pierde ni aparece un peso.
      expect(r.subtotalBase + r.ivaValor).toBe(total);
      expect(r.subtotalBase).toBeGreaterThanOrEqual(0);
      expect(r.ivaValor).toBeGreaterThanOrEqual(0);
    }
  });

  test('en montos diminutos el IVA redondea a cero sin desbalancear el total', () => {
    // 1 peso: el 19% discriminado es 0,16 pesos y la plataforma maneja enteros,
    // así que no hay IVA que facturar. El total queda intacto, que es lo que
    // importa: es un límite de redondeo, no un hueco.
    const r = discriminarIva(1, 0.19);

    expect(r.ivaValor).toBe(0);
    expect(r.subtotalBase).toBe(1);
  });

  test('rechaza montos o tarifas inválidas en vez de calcular con basura', () => {
    expect(() => discriminarIva(-1, 0.19)).toThrow(/no negativo/);
    expect(() => discriminarIva('no-es-un-numero', 0.19)).toThrow(/no negativo/);
    expect(() => discriminarIva(1000, 1.5)).toThrow(/entre 0 y 1/);
    expect(() => discriminarIva(1000, -0.1)).toThrow(/entre 0 y 1/);
    expect(() => discriminarIva(1000, 'x')).toThrow(/entre 0 y 1/);
  });

  test('un total de cero no inventa IVA', () => {
    const r = discriminarIva(0, 0.19);

    expect(r.ivaValor).toBe(0);
    expect(r.subtotalBase).toBe(0);
  });
});

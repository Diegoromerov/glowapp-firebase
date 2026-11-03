'use strict';

/**
 * Responsabilidad de IVA del prestador (W13).
 *
 * Lo que estas pruebas protegen:
 *   D1 — el valor se deriva del RUT y el override manual manda sobre él.
 *   D2 — sin número de RUT no se puede declarar.
 *   D3 — sin declaración NO se presume responsable (la entrada `null` no puede
 *        convertirse en `true` por accidente: eso haría que la plataforma
 *        discriminara un IVA que el prestador no ha acreditado).
 */
const {
  CODIGO_RESPONSABLE_IVA,
  CODIGO_NO_RESPONSABLE_IVA,
  normalizarRut,
  validarRut,
  validarCodigoResponsabilidad,
  resolverResponsabilidadIva,
} = require('../services/ivaPrestador');

describe('D2 — el número de RUT es obligatorio', () => {
  test('acepta cédula y NIT, con o sin guion del dígito de verificación', () => {
    for (const rut of ['1020304050', '900123456', '900123456-7', '10203040']) {
      expect(validarRut(rut).valido).toBe(true);
    }
  });

  test('limpia puntos y espacios antes de validar', () => {
    expect(validarRut(' 900.123.456-7 ').rut).toBe('900123456-7');
    expect(normalizarRut('1.020.304.050')).toBe('1020304050');
  });

  test('rechaza vacío, nulo y basura en vez de guardar un RUT inútil', () => {
    expect(validarRut(null).valido).toBe(false);
    expect(validarRut('   ').valido).toBe(false);
    expect(validarRut(undefined).valido).toBe(false);
    expect(validarRut('ABC123').valido).toBe(false);
    expect(validarRut('123').valido).toBe(false);
    expect(validarRut('12345678901234567890').valido).toBe(false);
  });
});

describe('La casilla de responsabilidades sólo admite 48 o 49', () => {
  test('acepta los dos códigos del RUT', () => {
    expect(validarCodigoResponsabilidad(48).codigo).toBe(48);
    expect(validarCodigoResponsabilidad(49).codigo).toBe(49);
    expect(validarCodigoResponsabilidad('49').codigo).toBe(49);
  });

  test('rechaza cualquier otro código', () => {
    for (const malo of [0, 47, 50, 4, 'x', null, undefined, 48.5]) {
      expect(validarCodigoResponsabilidad(malo).valido).toBe(false);
    }
  });
});

describe('D1 — el valor se deriva del RUT y el override manda', () => {
  test('código 48 → responsable, con fuente RUT', () => {
    expect(resolverResponsabilidadIva({ codigo: CODIGO_RESPONSABLE_IVA })).toEqual({
      responsableIva: true,
      fuente: 'RUT',
    });
  });

  test('código 49 → no responsable, con fuente RUT', () => {
    expect(resolverResponsabilidadIva({ codigo: CODIGO_NO_RESPONSABLE_IVA })).toEqual({
      responsableIva: false,
      fuente: 'RUT',
    });
  });

  test('el override manda sobre el RUT, y queda marcado como MANUAL', () => {
    // Un prestador que el RUT marca 49 pero que la plataforma decide tratar como
    // responsable (o al revés) deja traza de que fue una decisión, no una lectura.
    expect(resolverResponsabilidadIva({ codigo: 49, override: true })).toEqual({
      responsableIva: true,
      fuente: 'MANUAL',
    });
    expect(resolverResponsabilidadIva({ codigo: 48, override: false })).toEqual({
      responsableIva: false,
      fuente: 'MANUAL',
    });
  });

  test('el override funciona aunque no haya código declarado', () => {
    expect(resolverResponsabilidadIva({ override: true })).toEqual({
      responsableIva: true,
      fuente: 'MANUAL',
    });
  });

  test('override en null NO es un override: manda el RUT', () => {
    expect(resolverResponsabilidadIva({ codigo: 48, override: null })).toEqual({
      responsableIva: true,
      fuente: 'RUT',
    });
  });
});

describe('D3 — sin declaración NO se presume responsable', () => {
  test('sin código ni override devuelve null (sin declarar), nunca true', () => {
    expect(resolverResponsabilidadIva({})).toEqual({ responsableIva: null, fuente: null });
    expect(resolverResponsabilidadIva()).toEqual({ responsableIva: null, fuente: null });
    expect(resolverResponsabilidadIva({ codigo: null, override: null })).toEqual({
      responsableIva: null,
      fuente: null,
    });
  });

  test('un código inválido no se interpreta como responsable', () => {
    for (const raro of [0, 47, 99, 'cuarenta y ocho']) {
      expect(resolverResponsabilidadIva({ codigo: raro })).toEqual({
        responsableIva: null,
        fuente: null,
      });
    }
  });
});

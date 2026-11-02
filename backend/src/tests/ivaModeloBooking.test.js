'use strict';

/**
 * El desglose de IVA tiene que estar DECLARADO en el modelo de Sequelize.
 *
 * Por qué esta prueba existe: Sequelize sólo persiste los atributos que están
 * declarados en `sequelize.define(...)`. Un campo que se pasa a `Booking.create`
 * pero no está declarado se **descarta en silencio**, sin error y sin warning.
 *
 * Es exactamente el fallo que tuvo la primera versión de esta configuración: el
 * controlador calculaba `subtotal_base` e `iva_valor`, la migración creaba las
 * columnas, las pruebas de la aritmética pasaban... y los campos nunca llegaban
 * a la base de datos. Nada avisaba.
 */
const Booking = require('../models/Booking');

describe('Booking — el desglose de IVA está declarado en el modelo', () => {
  test('declara subtotal_base, iva_valor y tarifa_iva_aplicada', () => {
    const atributos = Object.keys(Booking.rawAttributes);

    expect(atributos).toEqual(
      expect.arrayContaining(['subtotal_base', 'iva_valor', 'tarifa_iva_aplicada'])
    );
  });

  test('los mapea a columnas con el mismo nombre que crea la migración 086', () => {
    // Si el `field` no coincide con el nombre de la columna, Sequelize escribe en
    // otra parte (o falla); la migración 086 usa estos nombres exactos.
    expect(Booking.rawAttributes.subtotal_base.field).toBe('subtotal_base');
    expect(Booking.rawAttributes.iva_valor.field).toBe('iva_valor');
    expect(Booking.rawAttributes.tarifa_iva_aplicada.field).toBe('tarifa_iva_aplicada');
  });

  test('la tarifa admite la precisión de la migración (NUMERIC(5,4), o sea 0.1900)', () => {
    // Con DECIMAL(5,4) entra 0.1900 sin perder dígitos; con un tipo más corto el
    // 19% se redondearía a 0.19 y se perdería la traza de la tarifa aplicada.
    expect(Booking.rawAttributes.tarifa_iva_aplicada.type.toSql()).toMatch(/DECIMAL\(5, ?4\)/i);
  });
});

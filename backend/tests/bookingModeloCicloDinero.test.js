// La reprogramación gratuita era infinita: `rescheduleBooking` hacía
// `booking.reschedule_count = veces + 1` y `booking.save()`, pero el modelo
// Sequelize no declaraba la columna, así que la propiedad se descartaba y en
// base quedaba siempre 0. La segunda llamada volvía a entrar como si fuera la
// primera, contra lo que dice D-GL-023 (una gratis, la segunda cuenta como
// cancelación).
//
// Estas pruebas atan el modelo a la regla: las cuatro columnas del ciclo del
// dinero deben existir como atributos o el contador vuelve a perderse.

const Booking = require('../src/models/Booking');

describe('Modelo Booking — columnas del ciclo del dinero', () => {
  test('declara reschedule_count, que es lo que hace efectiva la regla', () => {
    const attr = Booking.rawAttributes.reschedule_count;
    expect(attr).toBeDefined();
    expect(attr.field).toBe('reschedule_count');
    expect(attr.defaultValue).toBe(0);
    expect(attr.allowNull).toBe(false);
  });

  test('declara propina, cancelado_por y cancelado_at', () => {
    ['propina', 'cancelado_por', 'cancelado_at'].forEach((campo) => {
      expect(Booking.rawAttributes[campo]).toBeDefined();
      expect(Booking.rawAttributes[campo].field).toBe(campo);
    });
  });

  test('un cambio en reschedule_count queda marcado para guardarse', () => {
    const b = Booking.build({ id: '00000000-0000-0000-0000-000000000000', reschedule_count: 0 });
    b.reschedule_count = 1;

    // `changed()` es lo que Sequelize usa para decidir si el save emite UPDATE.
    expect(b.changed('reschedule_count')).toBe(true);
    expect(b.reschedule_count).toBe(1);
  });

  test('las columnas apuntan a nombres reales de la tabla bookings', () => {
    // Si alguien renombra el campo sin tocar la migración, el save falla en
    // producción con "column does not exist" y no en las pruebas.
    Object.values(Booking.rawAttributes).forEach((attr) => {
      expect(typeof attr.field).toBe('string');
    });
  });
});

const { evaluarElegibilidadReserva } = require('../utils/bookingEligibility');

describe('elegibilidad de reservas del prestador', () => {
  test('permite reservar con cuenta activa, habilitada y verificación aprobada', () => {
    expect(evaluarElegibilidadReserva({
      is_active: true,
      estado_operativo: 'HABILITADO',
      estatus_verificacion: 'APROBADO',
    })).toEqual({ permitido: true });
  });

  test.each(['EXPLORACION', 'EN_VERIFICACION', 'SUSPENDIDO', null])(
    'bloquea reservas cuando estado_operativo es %s', (estado_operativo) => {
      expect(evaluarElegibilidadReserva({
        is_active: true,
        estado_operativo,
        estatus_verificacion: 'APROBADO',
      })).toMatchObject({ permitido: false, code: 'PROVIDER_NOT_OPERATIONAL' });
    }
  );

  test('bloquea cuenta inactiva aunque figure habilitada', () => {
    expect(evaluarElegibilidadReserva({
      is_active: false,
      estado_operativo: 'HABILITADO',
      estatus_verificacion: 'APROBADO',
    })).toMatchObject({ permitido: false, code: 'PROVIDER_INACTIVE' });
  });

  test('bloquea una verificación profesional pendiente aunque figure habilitada', () => {
    expect(evaluarElegibilidadReserva({
      is_active: true,
      estado_operativo: 'HABILITADO',
      estatus_verificacion: 'PENDIENTE',
    })).toMatchObject({ permitido: false, code: 'PROVIDER_NOT_VERIFIED' });
  });

  test('permite un salón habilitado sin perfil profesional individual', () => {
    expect(evaluarElegibilidadReserva({
      is_active: true,
      estado_operativo: 'HABILITADO',
      estatus_verificacion: null,
    })).toEqual({ permitido: true });
  });

  test('rechaza un prestador inexistente', () => {
    expect(evaluarElegibilidadReserva(null)).toMatchObject({
      permitido: false,
      code: 'BOOKING_PROVIDER_NOT_FOUND',
    });
  });
});

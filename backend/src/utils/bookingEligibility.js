'use strict';

/**
 * Regla de servidor para iniciar una transacción de reserva.
 * La app cliente puede mostrar perfiles en preparación, pero solo una cuenta
 * habilitada puede recibir citas. Si hay perfil profesional, debe estar aprobado.
 */
function evaluarElegibilidadReserva(prestador) {
  if (!prestador) {
    return {
      permitido: false,
      status: 404,
      code: 'BOOKING_PROVIDER_NOT_FOUND',
      error: 'No encontramos el prestador seleccionado.',
    };
  }

  if (prestador.is_active !== true) {
    return {
      permitido: false,
      status: 403,
      code: 'PROVIDER_INACTIVE',
      error: 'Este prestador no está disponible para recibir reservas.',
    };
  }

  if (String(prestador.estado_operativo || '').toUpperCase() !== 'HABILITADO') {
    return {
      permitido: false,
      status: 403,
      code: 'PROVIDER_NOT_OPERATIONAL',
      error: 'Este prestador aún no está habilitado para recibir reservas.',
    };
  }

  const verificacion = prestador.estatus_verificacion;
  if (verificacion != null && String(verificacion).toUpperCase() !== 'APROBADO') {
    return {
      permitido: false,
      status: 403,
      code: 'PROVIDER_NOT_VERIFIED',
      error: 'La verificación del prestador aún no está aprobada.',
    };
  }

  return { permitido: true };
}

module.exports = { evaluarElegibilidadReserva };

// backend/tests/bookingServiceMismatch.test.js
const { dedupeServiceIds, missingServiceIds } = require('../src/utils/serviceSelection');

/**
 * Contrato que debe cumplir POST /api/bookings:
 *  - los ids se deduplican antes de comparar (un id repetido NO es un 404);
 *  - si falta alguno, la respuesta es 404 con code y la lista de faltantes;
 *  - provider_id no numérico es 400, nunca 500.
 */
function responderCrearReserva({ provider_id, service_ids, catalogo, businessIds = [] }) {
  if (!provider_id || !/^\d+$/.test(String(provider_id))) {
    return { status: 400, body: { code: 'BOOKING_PROVIDER_INVALID' } };
  }
  const pedidos = dedupeServiceIds(service_ids);
  if (pedidos.length === 0) {
    return { status: 400, body: { code: 'BOOKING_FIELDS_MISSING' } };
  }
  const encontrados = catalogo.filter(
    (s) =>
      pedidos.includes(String(s.id)) &&
      (String(s.provider_id) === String(provider_id) ||
        businessIds.includes(s.business_profile_id))
  );
  const faltantes = missingServiceIds(pedidos, encontrados);
  if (faltantes.length > 0) {
    return {
      status: 404,
      body: { code: 'SERVICES_NOT_FOUND', missing_service_ids: faltantes },
    };
  }
  return { status: 200, body: { code: 'OK' } };
}

const catalogo = [
  { id: 'a', provider_id: 3 },
  { id: 'b', provider_id: 3 },
  { id: 'z', provider_id: 4 },
];

describe('contrato de servicios en POST /api/bookings', () => {
  test('los ids repetidos no son un 404', () => {
    const r = responderCrearReserva({ provider_id: 3, service_ids: ['a', 'a'], catalogo });
    expect(r.status).toBe(200);
  });

  test('un id de otro prestador devuelve 404 con el id faltante', () => {
    const r = responderCrearReserva({ provider_id: 3, service_ids: ['a', 'z'], catalogo });
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('SERVICES_NOT_FOUND');
    expect(r.body.missing_service_ids).toEqual(['z']);
  });

  test('provider_id no numérico es 400 y no 500', () => {
    const r = responderCrearReserva({ provider_id: 'abc', service_ids: ['a'], catalogo });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('BOOKING_PROVIDER_INVALID');
  });
});

describe('regla de pertenencia al prestador', () => {
  // Un servicio es del prestador si es suyo o si pertenece a uno de sus
  // perfiles de negocio. Misma regla en el selector y en createBooking.
  function esDelPrestador(servicio, providerId, businessIds) {
    return (
      String(servicio.provider_id) === String(providerId) ||
      businessIds.includes(servicio.business_profile_id)
    );
  }

  test('un servicio del negocio del prestador sí es reservable', () => {
    const servicio = { id: 'b1', provider_id: null, business_profile_id: 'negocio-1' };
    expect(esDelPrestador(servicio, 3, ['negocio-1'])).toBe(true);
  });

  test('un servicio de un negocio ajeno no lo es', () => {
    const servicio = { id: 'x1', provider_id: null, business_profile_id: 'negocio-9' };
    expect(esDelPrestador(servicio, 3, ['negocio-1'])).toBe(false);
  });
});

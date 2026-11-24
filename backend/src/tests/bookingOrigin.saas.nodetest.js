const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BOOKING_ORIGIN,
  isSaasDirectBookingAudience,
  bookingOriginForAudience,
} = require('../utils/bookingOrigin');

test('solo las reservas iniciadas en la app del salón consumen la cuota SaaS directa', () => {
  assert.equal(isSaasDirectBookingAudience('provider'), true);
  assert.equal(isSaasDirectBookingAudience('client'), false);
  assert.equal(isSaasDirectBookingAudience(undefined), false);
});

test('cada audiencia recibe un origen inequívoco para atribuir la reserva', () => {
  assert.equal(bookingOriginForAudience('provider'), BOOKING_ORIGIN.SALON_DIRECT);
  assert.equal(bookingOriginForAudience('client'), BOOKING_ORIGIN.MARKETPLACE);
  assert.equal(bookingOriginForAudience('unknown'), BOOKING_ORIGIN.MARKETPLACE);
});

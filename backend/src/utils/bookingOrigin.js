const BOOKING_ORIGIN = Object.freeze({
  SALON_DIRECT: 'SALON_DIRECT',
  MARKETPLACE: 'MARKETPLACE',
});

function isSaasDirectBookingAudience(audience) {
  return audience === 'provider';
}

function bookingOriginForAudience(audience) {
  return isSaasDirectBookingAudience(audience)
    ? BOOKING_ORIGIN.SALON_DIRECT
    : BOOKING_ORIGIN.MARKETPLACE;
}

module.exports = { BOOKING_ORIGIN, isSaasDirectBookingAudience, bookingOriginForAudience };

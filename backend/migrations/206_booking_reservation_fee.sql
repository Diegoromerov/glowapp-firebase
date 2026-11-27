-- Ensure the reservation-fee field used by BookingController exists without
-- reapplying migration 011, which also replaces the booking commission trigger.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS tarifa_reserva NUMERIC(10,2) DEFAULT 0.00;

COMMENT ON COLUMN public.bookings.tarifa_reserva IS
  'Reservation fee persisted when creating a booking.';

-- Booking model supplies reschedule_count when creating a booking. Keep this
-- small migration separate from 097, which also creates refund/credit flows.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS reschedule_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.bookings.reschedule_count IS
  'Number of reschedules already used by the booking.';

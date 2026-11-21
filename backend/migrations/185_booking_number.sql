-- Número corto y consecutivo para mostrar/consultar citas.
-- bookings.id UUID sigue siendo la identidad interna y las FK no cambian.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS booking_number BIGINT GENERATED ALWAYS AS IDENTITY;

CREATE UNIQUE INDEX IF NOT EXISTS bookings_booking_number_uidx
  ON bookings (booking_number);

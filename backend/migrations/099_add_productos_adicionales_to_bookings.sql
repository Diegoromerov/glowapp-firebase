-- ============================================================
-- MIGRACIÓN 099: `bookings.productos_adicionales` explícito
--
-- La columna existe en producción desde antes de esta migración, pero ninguna
-- migración la creaba: se añadió a mano. Una base reconstruida desde `init.sql`
-- + migraciones se quedaba sin ella y la cancelación de una cita reventaba con
-- `column "productos_adicionales" does not exist`, porque el controlador lee esa
-- columna para revertir el stock de los productos añadidos a la reserva.
--
-- Idempotente: en producción no cambia nada.
-- ============================================================

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS productos_adicionales JSONB;

COMMENT ON COLUMN bookings.productos_adicionales IS
  'Productos añadidos a la reserva: lista o {products: [], linked_booking_ids: []}. Se usa al cancelar para revertir stock.';

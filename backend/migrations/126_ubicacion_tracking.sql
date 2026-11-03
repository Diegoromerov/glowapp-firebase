-- 126 — Ubicación en vivo separada de la ubicación del negocio
--
-- PROBLEMA
-- --------
-- El seguimiento escribía en `perfiles_prestador.ubicacion`, que es la
-- ubicación pública del negocio (la que usa el catálogo: `WHERE ubicacion IS
-- NOT NULL`). Cada reserva terminaba moviendo la ficha del prestador al último
-- punto GPS, y si se pusiera a NULL para limpiar, el prestador desaparecía del
-- catálogo porque la búsqueda exige ubicación no nula.
--
-- SOLUCIÓN
-- --------
-- Una columna aparte para la posición en vivo. `ubicacion` no se toca nunca
-- desde el seguimiento; `ubicacion_tracking` se borra al cerrar la reserva.

ALTER TABLE perfiles_prestador
  ADD COLUMN IF NOT EXISTS ubicacion_tracking GEOGRAPHY(Point, 4326);

COMMENT ON COLUMN perfiles_prestador.ubicacion_tracking IS
  'Posicion en vivo del prestador durante una reserva en curso. Se limpia al cerrarla. La ubicacion publica del negocio es perfiles_prestador.ubicacion.';

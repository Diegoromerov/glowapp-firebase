-- 127 — Aspectos de la reseña
--
-- El cliente califica con estrellas (1-5) y puede marcar aspectos concretos.
-- Una lista cerrada es lo que permite filtrar y agregar; el texto libre no se
-- puede consultar. La columna es aditiva y nula por defecto, así que las reseñas
-- existentes siguen válidas sin reescribir la tabla.

ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS aspectos JSONB;

COMMENT ON COLUMN reviews.aspectos IS
  'Aspectos marcados por el cliente: Puntualidad, Resultado, Trato, Higiene, Precio-calidad.';

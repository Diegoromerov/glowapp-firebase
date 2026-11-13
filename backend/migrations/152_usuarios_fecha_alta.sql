-- 152_usuarios_fecha_alta.sql
--
-- `usuarios` no tenía marca de alta. El programa de referidos la necesita: la
-- invitante quiere ver CUÁNDO se unió cada invitada, y sin columna la consulta
-- fallaba con «column created_at does not exist» — y como el controlador captura
-- el error para no tumbar la pantalla, se veía una lista vacía. Un fallo que se
-- disfraza de «no hay nadie».
--
-- Se añade con valor por defecto para que toda cuenta nueva la tenga sin tocar
-- los INSERT existentes. Las cuentas anteriores se rellenan con lo único que
-- sabemos de su alta: la fecha de aceptación de hábeas data, y si no, el
-- momento de esta migración (mejor aproximado que nulo en una lista ordenada).
--
-- Aditiva e idempotente.

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS fecha_alta TIMESTAMPTZ DEFAULT NOW();

UPDATE usuarios
   SET fecha_alta = COALESCE(habeas_data_accepted_at::timestamptz, fecha_alta, NOW())
 WHERE fecha_alta IS NULL;

COMMENT ON COLUMN usuarios.fecha_alta IS
  'Momento de creación de la cuenta. Base de «cuándo se unió» en referidos.';

CREATE INDEX IF NOT EXISTS idx_usuarios_fecha_alta ON usuarios(fecha_alta DESC);

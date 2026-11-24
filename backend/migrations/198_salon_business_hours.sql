-- Horario comercial general de cada sede SaaS.
-- La disponibilidad individual de cada profesional continúa en perfiles_prestador.
ALTER TABLE salones
  ADD COLUMN IF NOT EXISTS horario_atencion JSONB;

COMMENT ON COLUMN salones.horario_atencion IS
  'Horario general de apertura de la sede. La agenda individual sigue en perfiles_prestador.weekly_schedule.';

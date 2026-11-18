-- Añade metadata a las preferencias de notificación sin perder preferencias
-- existentes. IF NOT EXISTS permite reparar instalaciones ya inicializadas.
ALTER TABLE usuario_notificaciones_prefs
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

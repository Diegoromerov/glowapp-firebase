-- Permite ocultar un perfil público sin bloquear inicio de sesión ni la cuenta.
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS visibilidad_suspendida BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN usuarios.visibilidad_suspendida IS
  'Oculta el perfil público del proveedor sin desactivar ni bloquear su cuenta.';

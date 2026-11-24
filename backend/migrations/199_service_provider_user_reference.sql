-- `services.provider_id` identifica al usuario propietario del catálogo.
-- Los salones SaaS también administran servicios, aunque su dueño no tenga
-- un perfil individual en `perfiles_prestador`. La FK histórica de init.sql
-- apuntaba a esa tabla y bloqueaba el alta del primer servicio del salón.
-- La migración 054 ya define la relación correcta hacia `usuarios(id)`.
BEGIN;

ALTER TABLE services
  DROP CONSTRAINT IF EXISTS services_provider_id_fkey;

ALTER TABLE services
  ADD CONSTRAINT services_provider_id_fkey
  FOREIGN KEY (provider_id) REFERENCES usuarios(id)
  ON DELETE CASCADE NOT VALID;

ALTER TABLE services
  VALIDATE CONSTRAINT services_provider_id_fkey;

COMMENT ON COLUMN services.provider_id IS
  'Usuario propietario del catálogo; puede ser prestador individual o dueño SaaS de un salón.';

COMMIT;

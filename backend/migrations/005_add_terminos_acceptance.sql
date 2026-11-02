-- backend/migrations/005_add_terminos_acceptance.sql
-- Agregar campos para registrar auditoría de aceptación de Términos y Condiciones
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS terminos_accepted_at TIMESTAMPTZ;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS terminos_ip VARCHAR(45);

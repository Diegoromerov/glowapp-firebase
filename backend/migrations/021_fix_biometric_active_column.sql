-- backend/migrations/021_fix_biometric_active_column.sql
-- Asegurar que la columna 'active' exista en la tabla de consentimientos biométricos (Fase 1/Hub Biométrico)

ALTER TABLE biometric_consents 
ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;

-- Índice único parcial para garantizar un solo consentimiento activo
DROP INDEX IF EXISTS unique_active_consent;
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_consent ON biometric_consents (user_id) WHERE active = TRUE;

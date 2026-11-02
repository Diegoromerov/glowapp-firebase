-- backend/migrations/030_fix_beauty_profiles_defaults.sql
-- Asegurar valores por defecto DEFAULT gen_random_uuid() y DEFAULT NOW() en beauty_profiles

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
ALTER TABLE beauty_profiles ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE beauty_profiles ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE beauty_profiles ALTER COLUMN updated_at SET DEFAULT NOW();

COMMIT;

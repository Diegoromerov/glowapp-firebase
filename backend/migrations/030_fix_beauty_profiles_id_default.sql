-- backend/migrations/030_fix_beauty_profiles_id_default.sql
-- Asegurar DEFAULT gen_random_uuid() en la columna id de beauty_profiles

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
ALTER TABLE beauty_profiles ALTER COLUMN id SET DEFAULT gen_random_uuid();

COMMIT;

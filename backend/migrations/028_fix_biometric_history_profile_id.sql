-- backend/migrations/028_fix_biometric_history_profile_id.sql
-- Modifica profile_id a TEXT en biometric_history para soportar IDs tanto numéricos como UUID

BEGIN;

ALTER TABLE biometric_history DROP CONSTRAINT IF EXISTS biometric_history_profile_id_fkey;
ALTER TABLE biometric_history ALTER COLUMN profile_id TYPE TEXT USING profile_id::text;

COMMIT;

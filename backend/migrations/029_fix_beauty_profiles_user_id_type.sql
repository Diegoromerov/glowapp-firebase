-- backend/migrations/029_fix_beauty_profiles_user_id_type.sql
-- Alineación del tipo de columna user_id en beauty_profiles de UUID a INTEGER

BEGIN;

ALTER TABLE beauty_profiles DROP CONSTRAINT IF EXISTS beauty_profiles_user_id_fkey;
ALTER TABLE beauty_profiles DROP CONSTRAINT IF EXISTS unique_beauty_profiles_user_id;

ALTER TABLE beauty_profiles ALTER COLUMN user_id DROP DEFAULT;
ALTER TABLE beauty_profiles ALTER COLUMN user_id TYPE INTEGER USING (
    CASE 
        WHEN user_id::text ~ '^[0-9]+$' THEN user_id::text::integer 
        ELSE NULL 
    END
);
ALTER TABLE beauty_profiles ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE beauty_profiles ADD CONSTRAINT unique_beauty_profiles_user_id UNIQUE (user_id);
ALTER TABLE beauty_profiles ADD CONSTRAINT beauty_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES usuarios(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_beauty_profiles_user_id ON beauty_profiles(user_id);

COMMIT;

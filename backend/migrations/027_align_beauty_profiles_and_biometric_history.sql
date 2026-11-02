-- backend/migrations/027_align_beauty_profiles_and_biometric_history.sql
-- Alineación de esquema para beauty_profiles y creación de la tabla biometric_history

BEGIN;

-- 1. Crear tabla beauty_profiles si no existe
CREATE TABLE IF NOT EXISTS beauty_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    face_scores JSONB NOT NULL,
    hands_diagnosis JSONB NOT NULL,
    recommendation TEXT NOT NULL,
    recommended_products JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Asegurar restricción UNIQUE en user_id para soportar el ON CONFLICT (user_id) de profile.service.js
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'unique_beauty_profiles_user_id'
    ) THEN
        ALTER TABLE beauty_profiles ADD CONSTRAINT unique_beauty_profiles_user_id UNIQUE (user_id);
    END IF;
END $$;

-- 2. Asegurar columnas en beauty_profiles por si la tabla ya existía con esquema antiguo
ALTER TABLE beauty_profiles ADD COLUMN IF NOT EXISTS face_scores JSONB;
ALTER TABLE beauty_profiles ADD COLUMN IF NOT EXISTS hands_diagnosis JSONB;
ALTER TABLE beauty_profiles ADD COLUMN IF NOT EXISTS recommendation TEXT;
ALTER TABLE beauty_profiles ADD COLUMN IF NOT EXISTS recommended_products JSONB;
ALTER TABLE beauty_profiles ADD COLUMN IF NOT EXISTS entry_point VARCHAR(50) DEFAULT 'ideas';
ALTER TABLE beauty_profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 3. Crear tabla biometric_history si no existe (usada por profile.service.js para auditoría)
CREATE TABLE IF NOT EXISTS biometric_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    profile_id UUID REFERENCES beauty_profiles(id) ON DELETE SET NULL,
    face_scores JSONB,
    hands_diagnosis JSONB,
    recommendation TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Índices de rendimiento
CREATE INDEX IF NOT EXISTS idx_beauty_profiles_user_id ON beauty_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_biometric_history_user_id ON biometric_history(user_id);

COMMIT;

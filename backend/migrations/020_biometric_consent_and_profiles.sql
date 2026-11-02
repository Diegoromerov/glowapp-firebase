-- backend/migrations/020_biometric_consent_and_profiles.sql
-- Migración para el Hub Biométrico y Consentimiento (Fase 1)

-- 1. Tabla de consentimiento biométrico
CREATE TABLE IF NOT EXISTS biometric_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    version VARCHAR(20) NOT NULL,
    accepted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ip VARCHAR(45),
    user_agent TEXT,
    revoked_at TIMESTAMP WITH TIME ZONE,
    active BOOLEAN DEFAULT TRUE
);

-- Índice único parcial para garantizar un solo consentimiento activo
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_consent ON biometric_consents (user_id) WHERE active = TRUE;

-- 2. Tabla de perfiles biométricos
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

-- 3. Índices
CREATE INDEX IF NOT EXISTS idx_beauty_profiles_user_id ON beauty_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_biometric_consents_user_id ON biometric_consents(user_id);

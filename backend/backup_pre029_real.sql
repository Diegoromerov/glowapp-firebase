-- PostgreSQL database dump for beauty_profiles & biometric_history
-- Generated on: 2026-07-24T23:28:37.807Z
-- Database Host: caboose.proxy.rlwy.net:18931/railway

-- Structure for table: beauty_profiles
DROP TABLE IF EXISTS beauty_profiles CASCADE;
CREATE TABLE beauty_profiles (
    user_id UUID NOT NULL,
    skin_subtone CHARACTER VARYING,
    skin_subtone_confidence DOUBLE PRECISION,
    skin_concerns JSONB,
    hair_diagnosis JSONB,
    hand_morphology JSONB,
    brow_visajismo JSONB,
    trend_affinity JSONB,
    evolution_history JSONB,
    beauty_score INTEGER,
    id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    face_scores JSONB,
    hands_diagnosis JSONB,
    recommendation TEXT,
    recommended_products JSONB,
    entry_point CHARACTER VARYING DEFAULT 'ideas'::character varying
);

-- Data for table: beauty_profiles (0 rows)

-- Structure for table: biometric_history
DROP TABLE IF EXISTS biometric_history CASCADE;
CREATE TABLE biometric_history (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL,
    profile_id TEXT,
    face_scores JSONB,
    hands_diagnosis JSONB,
    recommendation TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Data for table: biometric_history (0 rows)


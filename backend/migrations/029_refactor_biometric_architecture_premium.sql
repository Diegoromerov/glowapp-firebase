-- backend/migrations/029_refactor_biometric_architecture_premium.sql
-- Migración para alineación al ADR-001: Módulo Biométrico Premium (Fase 2)

BEGIN;

-- 1. Asegurar extensión pgvector para embeddings semánticos
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Asegurar extensión pgcrypto para UUIDs y funciones criptográficas
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 3. Crear tabla de auditoría append-only para consentimientos legales (GDPR / Ley 1581 Art. 30)
CREATE TABLE IF NOT EXISTS biometric_consent_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL,
    version VARCHAR(20) NOT NULL DEFAULT '1.0',
    action VARCHAR(50) NOT NULL, -- 'GRANTED', 'REVOKED', 'EXPIRED'
    ip_hash VARCHAR(64) NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_biometric_consent_log_user ON biometric_consent_log(user_id, created_at DESC);

-- 4. Crear tabla relacional scan_product_matches para desnormalizar JSONB array
CREATE TABLE IF NOT EXISTS scan_product_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    match_score NUMERIC(5,4) NOT NULL,
    reasoning TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scan_product_matches_profile ON scan_product_matches(profile_id);
CREATE INDEX IF NOT EXISTS idx_scan_product_matches_product ON scan_product_matches(product_id);

-- 5. Añadir índices de rendimiento BTREE y GIN a user_biometrics si existe la tabla
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'user_biometrics') THEN
        -- Índice B-Tree compuesto para historial cronológico
        CREATE INDEX IF NOT EXISTS idx_user_biometrics_user_created ON user_biometrics(user_id, created_at DESC);
        
        -- Índice GIN en concern_tags si existe la columna
        IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'user_biometrics' AND column_name = 'concern_tags') THEN
            CREATE INDEX IF NOT EXISTS idx_user_biometrics_concerns_gin ON user_biometrics USING GIN (concern_tags);
        END IF;

        -- Índice HNSW en deepseek_embedding si existe la columna de vector
        IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'user_biometrics' AND column_name = 'deepseek_embedding') THEN
            CREATE INDEX IF NOT EXISTS idx_user_biometrics_embedding_hnsw ON user_biometrics USING hnsw (deepseek_embedding vector_cosine_ops);
        END IF;
    END IF;
END $$;

COMMIT;

-- c:\beauty-app\backend\migrations\008_social_integrations.sql

-- Tabla de vinculación OAuth de cuentas sociales por usuario
CREATE TABLE IF NOT EXISTS user_social_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    provider VARCHAR(30) NOT NULL CHECK (provider IN ('TIKTOK', 'INSTAGRAM', 'FACEBOOK')),
    provider_user_id VARCHAR(255) NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    scopes TEXT[] DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_user_provider UNIQUE (user_id, provider)
);

-- Tabla para registro auditable de contenidos compartidos y prevención de abuso / recompensas XP
CREATE TABLE IF NOT EXISTS social_shares_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    platform VARCHAR(30) NOT NULL CHECK (platform IN ('TIKTOK', 'INSTAGRAM', 'FACEBOOK', 'WHATSAPP')),
    content_type VARCHAR(50) NOT NULL CHECK (content_type IN ('AI_COLORIMETRY', 'VTO_LOOK', 'ACADEMY_CERT', 'PROVIDER_PROFILE')),
    share_reference_id VARCHAR(255),
    reward_granted BOOLEAN DEFAULT FALSE,
    points_awarded INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_accounts_user ON user_social_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_social_shares_user ON social_shares_log(user_id, created_at DESC);

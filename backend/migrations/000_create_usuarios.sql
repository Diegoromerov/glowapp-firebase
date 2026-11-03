-- ============================================================
-- MIGRACIÓN 000: Crear tabla de usuarios (base)
-- ============================================================

CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255),
    phone VARCHAR(20),
    foto_url TEXT,
    auth_provider VARCHAR(50) NOT NULL DEFAULT 'LOCAL',
    provider_id VARCHAR(255),
    rol VARCHAR(20),
    onboarding_completo BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    habeas_data_accepted_at DATE,
    habeas_data_ip VARCHAR(45)
);

-- Índices adicionales que podrían ser esperados
CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);
CREATE INDEX IF NOT EXISTS idx_usuarios_auth_provider ON usuarios(auth_provider);

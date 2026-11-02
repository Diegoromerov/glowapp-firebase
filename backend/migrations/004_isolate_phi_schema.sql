-- c:\beauty-app\backend\migrations\004_isolate_phi_schema.sql
-- MIGRACIÓN DE AISLAMIENTO DE INFORMACIÓN DE SALUD PROTEGIDA (PHI) Y BIOMETRÍA

CREATE SCHEMA IF NOT EXISTS phi_vault;

-- Mover tabla de vectores biométricos a esquema seguro y aislado
CREATE TABLE IF NOT EXISTS phi_vault.biometric_vectors (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL,
    scan_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    face_mesh_encrypted TEXT NOT NULL,
    skin_analysis_json JSONB,
    purged_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Habilitar extensión pgcrypto para cifrado a nivel de columna
CREATE EXTENSION IF NOT EXISTS pgcrypto;

COMMENT ON SCHEMA phi_vault IS 'Esquema aislado con políticas estrictas de privacidad para cumplimiento ARCO/GDPR/Ley 1581';

-- Migración para crear tablas de retención faltantes
-- Se ejecuta como migración independiente

-- 1. Tabla para imágenes biométricas originales (user_photos)
CREATE TABLE IF NOT EXISTS user_photos (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    url_or_path TEXT NOT NULL,  -- URL o path donde se almacena la imagen
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Tabla de registro de acceso biométrico (biometric_access_log)
CREATE TABLE IF NOT EXISTS biometric_access_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    accessed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ip_address INET,
    endpoint VARCHAR(255),
    user_agent TEXT
);

-- 3. Tabla de logs de operación (logs_debug_operacionales)
CREATE TABLE IF NOT EXISTS logs_debug_operacionales (
    id SERIAL PRIMARY KEY,
    mensaje TEXT NOT NULL,
    nivel VARCHAR(20) DEFAULT 'INFO' CHECK (nivel IN ('DEBUG', 'INFO', 'WARN', 'ERROR')),
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB  -- Para almacenar contexto adicional de forma estructurada
);

-- Índices para mejorar el rendimiento de las consultas de retención
CREATE INDEX IF NOT EXISTS idx_user_photos_created_at ON user_photos(created_at);
CREATE INDEX IF NOT EXISTS idx_biometric_access_log_accessed_at ON biometric_access_log(accessed_at);
CREATE INDEX IF NOT EXISTS idx_logs_debug_operacionales_creado_en ON logs_debug_operacionales(creado_en);
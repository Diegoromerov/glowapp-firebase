-- backend/migrations/044_create_user_preferences.sql
-- Tabla de preferencias de usuario para configuración de privacidad y notificaciones
-- Referencia: Auditoría Configuración & Privacidad (Fase 1-4)

CREATE TABLE IF NOT EXISTS user_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    telemetry_enabled BOOLEAN NOT NULL DEFAULT true,
    push_enabled BOOLEAN NOT NULL DEFAULT true,
    marketing_enabled BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para consultas frecuentes por user_id (ya es PK, pero explícito para claridad)
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);

-- Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_user_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_user_preferences_updated_at ON user_preferences;
CREATE TRIGGER trigger_update_user_preferences_updated_at
    BEFORE UPDATE ON user_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_user_preferences_updated_at();

-- Comentarios para documentación
COMMENT ON TABLE user_preferences IS 'Preferencias de privacidad y comunicación del usuario (Ley 1581/2012)';
COMMENT ON COLUMN user_preferences.telemetry_enabled IS 'Permitir telemetría anónima de uso para mejora de modelos Aura AI';
COMMENT ON COLUMN user_preferences.push_enabled IS 'Permitir notificaciones push (recordatorios, ofertas, alertas)';
COMMENT ON COLUMN user_preferences.marketing_enabled IS 'Permitir comunicaciones de marketing (Novedades Luxe, boletines)';
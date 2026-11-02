-- backend/migrations/003_habeas_data_and_config.sql

-- 1. Añadir campos para Habeas Data en la tabla de usuarios
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS habeas_data_accepted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS habeas_data_ip VARCHAR(45) DEFAULT NULL;

-- 2. Insertar valores por defecto para geolocalización dinámica en platform_config
INSERT INTO platform_config (key, value, descripcion) VALUES
  ('gps_centro_latitud', '4.6735', 'Latitud por defecto del centro de la zona de servicio'),
  ('gps_centro_longitud', '-74.1422', 'Longitud por defecto del centro de la zona de servicio'),
  ('gps_default_radio_metros', '5000', 'Radio de búsqueda geográfico por defecto en metros')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- 3. Crear tabla para autenticación multifactor (MFA) de administradores
CREATE TABLE IF NOT EXISTS admin_mfa (
  user_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  secret_key VARCHAR(255) NOT NULL,
  is_enabled BOOLEAN DEFAULT FALSE,
  backup_codes TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

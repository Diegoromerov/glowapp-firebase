-- Asegurar que la extensión PostGIS esté habilitada
CREATE EXTENSION IF NOT EXISTS postgis;

-- Asegurar que la columna foto_url exista en usuarios
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS foto_url TEXT;

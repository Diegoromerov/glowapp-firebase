-- Migración 064: Agregar ubicación geográfica y flags de visibilidad a la tabla salones
DO $$
BEGIN
    -- 1. Asegurar extensión PostGIS
    CREATE EXTENSION IF NOT EXISTS postgis;

    -- 2. Columnas de coordenadas en grados decimales
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'salones' AND column_name = 'latitude') THEN
        ALTER TABLE salones ADD COLUMN latitude NUMERIC(10, 7);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'salones' AND column_name = 'longitude') THEN
        ALTER TABLE salones ADD COLUMN longitude NUMERIC(10, 7);
    END IF;

    -- 3. Geometría espacial PostGIS para cálculos de distancia
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'salones' AND column_name = 'ubicacion') THEN
        ALTER TABLE salones ADD COLUMN ubicacion geography(Point, 4326);
    END IF;

    -- 4. Flags de existencia/activación y publicación pública
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'salones' AND column_name = 'location_enabled') THEN
        ALTER TABLE salones ADD COLUMN location_enabled BOOLEAN DEFAULT FALSE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'salones' AND column_name = 'location_public') THEN
        ALTER TABLE salones ADD COLUMN location_public BOOLEAN DEFAULT TRUE;
    END IF;

    -- 5. Índice espacial GIST para búsquedas por proximidad ultra rápidas
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'salones' AND indexname = 'idx_salones_ubicacion_gist') THEN
        CREATE INDEX idx_salones_ubicacion_gist ON salones USING GIST(ubicacion);
    END IF;

END $$;

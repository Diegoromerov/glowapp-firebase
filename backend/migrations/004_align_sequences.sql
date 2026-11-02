-- backend/migrations/004_align_sequences.sql
-- Sincronizar secuencia de usuarios (usuarios usa id SERIAL/integer)
SELECT setval('usuarios_id_seq', (SELECT COALESCE(MAX(id), 0) FROM usuarios) + 1, false);

-- Sincronizar secuencia de bookings/citas si existe (bookings usa id UUID)
-- Se envuelve en bloques condicionales PL/pgSQL para evitar errores en tiempo de análisis de PostgreSQL si las secuencias no existen.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'bookings_id_seq') THEN
    EXECUTE 'SELECT setval(''bookings_id_seq'', (SELECT COALESCE(MAX(id::text), ''0'')::integer FROM bookings WHERE id::text ~ ''^[0-9]+$'') + 1, false)';
  END IF;
END $$;

-- Sincronizar secuencia de servicios si existe (services usa id UUID o integer)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'services_id_seq') THEN
    EXECUTE 'SELECT setval(''services_id_seq'', (SELECT COALESCE(MAX(id::text), ''0'')::integer FROM services WHERE id::text ~ ''^[0-9]+$'') + 1, false)';
  END IF;
END $$;

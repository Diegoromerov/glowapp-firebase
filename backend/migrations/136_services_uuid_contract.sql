-- 136: contrato de tipo de services.id.
--
-- Produccion usa `services.id UUID DEFAULT gen_random_uuid()` (init.sql:84) y
-- `bookings.service_id UUID` (init.sql:101). La migracion 054 declaraba SERIAL e
-- INTEGER, pero nunca se aplico porque `CREATE TABLE IF NOT EXISTS` encuentra la
-- tabla ya creada por init.sql: el archivo describia un esquema que no existe en
-- ningun entorno (P-119 lo dejo anotado).
--
-- Esta migracion NO convierte nada: cambiar el tipo de una PK referenciada por
-- bookings y booking_productos exige un rewrite con ventana de mantenimiento.
-- Deja el contrato registrado y consultable, en vez de depender de un RAISE
-- NOTICE que el cliente de PostgreSQL no imprime en los logs del arranque.
BEGIN;

CREATE TABLE IF NOT EXISTS schema_contracts (
  nombre TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

DO $$
DECLARE
  v_id TEXT;
  v_fk TEXT;
BEGIN
  SELECT data_type INTO v_id
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'id';

  SELECT data_type INTO v_fk
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'service_id';

  INSERT INTO schema_contracts (nombre, valor)
  VALUES ('services.id', COALESCE(v_id, 'ausente'))
  ON CONFLICT (nombre) DO UPDATE
    SET valor = EXCLUDED.valor, actualizado_en = clock_timestamp();

  INSERT INTO schema_contracts (nombre, valor)
  VALUES ('bookings.service_id', COALESCE(v_fk, 'ausente'))
  ON CONFLICT (nombre) DO UPDATE
    SET valor = EXCLUDED.valor, actualizado_en = clock_timestamp();

  IF v_id = 'uuid' THEN
    RAISE NOTICE '136: services.id es uuid, igual que produccion. Contrato OK.';
  ELSE
    RAISE NOTICE '136: ATENCION services.id es % y produccion usa uuid; los ids entre entornos no son interoperables.', v_id;
  END IF;
END $$;

COMMIT;

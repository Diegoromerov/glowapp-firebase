-- Migration 033: Añade columna id a academy_certificates y establece la PK
-- La tabla original (008) tiene PK compuesta (provider_id, course_id)
-- Esta migración añade un surrogate key 'id' y convierte la PK compuesta en UNIQUE

-- FIX 2026-09-22: la versión anterior detectaba la PK con
--   `constraint_name LIKE '%provider_id%'`
-- pero PostgreSQL la había nombrado `academy_certificates_pkey`, así que el bloque nunca
-- entraba: `id` quedaba como columna suelta (sin UNIQUE ni PK) y 034 no podía crear la FK
-- (`there is no unique constraint matching given keys for referenced table`).
-- Ahora la detección se hace por COLUMNAS (pg_constraint + pg_attribute), no por nombre, y
-- es idempotente al re-ejecutarse en cada arranque.

DO $$
DECLARE
    pk_cols text;
    pk_name text;
BEGIN
    -- 1. Añadir columna id si no existe
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'academy_certificates'
          AND column_name = 'id'
    ) THEN
        ALTER TABLE academy_certificates ADD COLUMN id SERIAL;
    END IF;

    -- 2. ¿Cuáles son HOY las columnas de la PK? (nombre y columnas por separado:
    --    un solo SELECT con agregado + columna no agrupada es SQL inválido)
    SELECT c.conname
      INTO pk_name
      FROM pg_constraint c
     WHERE c.conrelid = 'academy_certificates'::regclass
       AND c.contype = 'p';

    SELECT string_agg(a.attname, ',' ORDER BY a.attname)
      INTO pk_cols
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.conrelid = 'academy_certificates'::regclass
       AND c.contype = 'p';

    -- 3. Si la PK todavía no es 'id', promoverla conservando la unicidad funcional
    IF pk_cols IS DISTINCT FROM 'id' THEN
        IF pk_name IS NOT NULL THEN
            EXECUTE format('ALTER TABLE academy_certificates DROP CONSTRAINT %I', pk_name);
        END IF;

        ALTER TABLE academy_certificates ADD CONSTRAINT academy_certificates_pkey PRIMARY KEY (id);

        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
             WHERE conrelid = 'academy_certificates'::regclass
               AND contype IN ('u', 'p')
               AND pg_get_constraintdef(oid) LIKE '%(provider_id, course_id)%'
        ) THEN
            ALTER TABLE academy_certificates
                ADD CONSTRAINT unique_provider_course UNIQUE (provider_id, course_id);
        END IF;

        RAISE NOTICE 'academy_certificates: PK promovida a (id), UNIQUE (provider_id, course_id) asegurada.';
    END IF;
END $$;

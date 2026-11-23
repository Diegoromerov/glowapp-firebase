-- Fase 4: hacer explícito el negocio y la sede dueños de servicios y reservas.
-- El backfill solo completa relaciones inequívocas; los casos ambiguos quedan
-- NULL para revisión y no se asignan a una sede arbitraria.
BEGIN;

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS business_profile_id VARCHAR(36),
  ADD COLUMN IF NOT EXISTS salon_id INTEGER;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS business_profile_id VARCHAR(36),
  ADD COLUMN IF NOT EXISTS salon_id INTEGER;

-- Algunas bases históricas crearon este campo como UUID, aunque
-- business_profiles.id es VARCHAR(36). Conservamos como texto los UUID que sí
-- correspondan a perfiles reales y limpiamos referencias huérfanas a NULL antes
-- de activar las FKs, para que servicios históricos sigan siendo editables.
DO $$
DECLARE
  service_profile_type TEXT;
BEGIN
  SELECT data_type INTO service_profile_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'services'
     AND column_name = 'business_profile_id';

  IF service_profile_type = 'uuid' THEN
    ALTER TABLE services
      ALTER COLUMN business_profile_id TYPE VARCHAR(36)
      USING business_profile_id::text;
  ELSIF service_profile_type IS DISTINCT FROM 'character varying' THEN
    RAISE EXCEPTION 'services.business_profile_id debe ser UUID o VARCHAR; encontrado: %', service_profile_type;
  END IF;
END $$;

UPDATE services s
   SET business_profile_id = NULL
 WHERE s.business_profile_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM business_profiles bp WHERE bp.id = s.business_profile_id
   );

-- Las claves compuestas permiten que PostgreSQL compruebe también la
-- pertenencia entre sede, negocio, servicio y reserva. Son redundantes respecto
-- a las PK en unicidad, pero necesarias como destino de las FKs compuestas.
CREATE UNIQUE INDEX IF NOT EXISTS uq_salones_id_business_profile
  ON salones (id, business_profile_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_services_id_business_profile
  ON services (id, business_profile_id);

-- Un prestador puede estar relacionado con más de un perfil. Solo se deriva
-- business_profile_id cuando tiene uno; en otro caso permanece pendiente.
WITH perfiles_unicos AS (
  SELECT provider_id, MIN(id) AS business_profile_id
    FROM business_profiles
   WHERE provider_id IS NOT NULL
   GROUP BY provider_id
  HAVING COUNT(*) = 1
)
UPDATE services s
   SET business_profile_id = p.business_profile_id
  FROM perfiles_unicos p
 WHERE s.business_profile_id IS NULL
   AND s.provider_id = p.provider_id;

-- Solo asignar una sede si el perfil tiene exactamente una.
WITH sedes_unicas AS (
  SELECT business_profile_id, MIN(id) AS salon_id
    FROM salones
   WHERE business_profile_id IS NOT NULL
   GROUP BY business_profile_id
  HAVING COUNT(*) = 1
)
UPDATE services s
   SET salon_id = su.salon_id
  FROM sedes_unicas su
 WHERE s.salon_id IS NULL
   AND s.business_profile_id = su.business_profile_id;

-- Las reservas históricas heredan la sede únicamente desde su servicio.
UPDATE bookings b
   SET salon_id = s.salon_id
  FROM services s
 WHERE b.salon_id IS NULL
   AND b.service_id = s.id
   AND s.salon_id IS NOT NULL;

UPDATE bookings b
   SET business_profile_id = s.business_profile_id
  FROM services s
 WHERE b.business_profile_id IS NULL
   AND b.service_id = s.id
   AND s.business_profile_id IS NOT NULL;

-- Añadir FKs después del backfill evita que datos históricos ambiguos o
-- inconsistentes bloqueen la migración; NOT VALID preserva esos datos, pero
-- PostgreSQL sí protege nuevas escrituras y actualizaciones.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_services_business_profile'
       AND conrelid = 'public.services'::regclass
  ) THEN
    ALTER TABLE services ADD CONSTRAINT fk_services_business_profile
      FOREIGN KEY (business_profile_id) REFERENCES business_profiles(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_services_salon'
       AND conrelid = 'public.services'::regclass
  ) THEN
    ALTER TABLE services ADD CONSTRAINT fk_services_salon
      FOREIGN KEY (salon_id) REFERENCES salones(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_bookings_business_profile'
       AND conrelid = 'public.bookings'::regclass
  ) THEN
    ALTER TABLE bookings ADD CONSTRAINT fk_bookings_business_profile
      FOREIGN KEY (business_profile_id) REFERENCES business_profiles(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_bookings_salon'
       AND conrelid = 'public.bookings'::regclass
  ) THEN
    ALTER TABLE bookings ADD CONSTRAINT fk_bookings_salon
      FOREIGN KEY (salon_id) REFERENCES salones(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_services_salon_business_profile'
       AND conrelid = 'public.services'::regclass
  ) THEN
    ALTER TABLE services ADD CONSTRAINT fk_services_salon_business_profile
      FOREIGN KEY (salon_id, business_profile_id)
      REFERENCES salones(id, business_profile_id)
      MATCH SIMPLE ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_bookings_service_scope'
       AND conrelid = 'public.bookings'::regclass
  ) THEN
    ALTER TABLE bookings ADD CONSTRAINT fk_bookings_service_scope
      FOREIGN KEY (service_id, business_profile_id)
      REFERENCES services(id, business_profile_id)
      MATCH SIMPLE ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_bookings_salon_business_profile'
       AND conrelid = 'public.bookings'::regclass
  ) THEN
    ALTER TABLE bookings ADD CONSTRAINT fk_bookings_salon_business_profile
      FOREIGN KEY (salon_id, business_profile_id)
      REFERENCES salones(id, business_profile_id)
      MATCH SIMPLE ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_services_business_profile_salon
  ON services (business_profile_id, salon_id)
  WHERE business_profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_business_profile_scheduled
  ON bookings (business_profile_id, scheduled_at)
  WHERE business_profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_salon_provider_scheduled
  ON bookings (salon_id, provider_id, scheduled_at)
  WHERE salon_id IS NOT NULL;

COMMENT ON COLUMN services.business_profile_id IS
  'Perfil SaaS propietario del servicio; se completa solo cuando la relación es inequívoca.';
COMMENT ON COLUMN services.salon_id IS
  'Sede que ofrece el servicio; puede ser NULL durante compatibilidad histórica.';
COMMENT ON COLUMN bookings.salon_id IS
  'Sede objetivo de la reserva; se deriva del servicio y se valida al crear.';
COMMENT ON COLUMN bookings.business_profile_id IS
  'Perfil SaaS propietario de la reserva; se deriva del servicio y se valida al crear.';

COMMIT;

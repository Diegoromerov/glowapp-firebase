-- 135: horario de atención del prestador (weekly_schedule, active_start_hour, active_end_hour).
--
-- Drift de esquema corregido: `GET /api/providers` (providerController) y las rutas
-- de horario de providerRoutes leen perfiles_prestador.active_start_hour,
-- active_end_hour y weekly_schedule, pero NINGUNA migración de la cadena 000–134
-- creaba esas columnas. Existían solo en railway_seed.sql,
-- seed/prestadores-demo-11.sql y scripts/e2e/schema-base.sql, de modo que toda base
-- construida desde la cadena de migraciones (CI, staging nuevo, restore limpio)
-- fallaba con «column p.active_start_hour does not exist» y la transacción quedaba
-- abortada. Producción pasaba porque la columna se había creado a mano por script.
--
-- Reejecutable a propósito: ADD COLUMN IF NOT EXISTS y backfill limitado a NULL,
-- por lo que puede vivir en la lista de arranque sin tocar datos ya definidos.
BEGIN;

ALTER TABLE perfiles_prestador ADD COLUMN IF NOT EXISTS weekly_schedule JSONB;
ALTER TABLE perfiles_prestador ADD COLUMN IF NOT EXISTS active_start_hour INTEGER;
ALTER TABLE perfiles_prestador ADD COLUMN IF NOT EXISTS active_end_hour INTEGER;

-- Backfill desde weekly_schedule, solo en filas sin rango horario definido.
-- Las expresiones 'inicio'/'fin' se filtran por forma numérica para que un valor
-- con formato libre en la agenda no aborte el arranque de la API.
WITH agenda AS (
  SELECT p.id,
         MIN((d.value->>'inicio')::int) AS inicio,
         MAX((d.value->>'fin')::int)    AS fin
    FROM perfiles_prestador p
    CROSS JOIN LATERAL jsonb_each(
      CASE WHEN jsonb_typeof(p.weekly_schedule) = 'object'
           THEN p.weekly_schedule ELSE '{}'::jsonb END
    ) AS d(day, value)
   WHERE d.value->>'activo' = 'true'
     AND d.value->>'inicio' ~ '^[0-9]{1,2}$'
     AND d.value->>'fin'    ~ '^[0-9]{1,2}$'
   GROUP BY p.id
)
UPDATE perfiles_prestador p
   SET active_start_hour = LEAST(a.inicio, 24),
       active_end_hour   = LEAST(GREATEST(a.fin, a.inicio), 24)
  FROM agenda a
 WHERE a.id = p.id
   AND p.active_start_hour IS NULL
   AND p.active_end_hour IS NULL;

UPDATE perfiles_prestador SET active_start_hour = 9  WHERE active_start_hour IS NULL;
UPDATE perfiles_prestador SET active_end_hour   = 19 WHERE active_end_hour   IS NULL;

ALTER TABLE perfiles_prestador ALTER COLUMN active_start_hour SET DEFAULT 9;
ALTER TABLE perfiles_prestador ALTER COLUMN active_end_hour   SET DEFAULT 19;

-- Rango válido sin bloquear filas heredadas: NOT VALID se aplica solo a escrituras nuevas.
ALTER TABLE perfiles_prestador DROP CONSTRAINT IF EXISTS perfiles_prestador_horario_atencion_check;
ALTER TABLE perfiles_prestador ADD CONSTRAINT perfiles_prestador_horario_atencion_check
  CHECK (active_start_hour BETWEEN 0 AND 24 AND active_end_hour BETWEEN 0 AND 24) NOT VALID;

COMMIT;

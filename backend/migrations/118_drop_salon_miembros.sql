-- 118_drop_salon_miembros.sql
-- T-127 (D-GL-027) — retirar la tabla heredada de miembros del salón.
--
-- CONTEXTO
-- `salon_miembros` (migración 067) fue el primer modelo de pertenencia. Desde la
-- 082 la fuente única es `business_profiles` + `memberships`, y desde la 113 el
-- backfill copió cada fila heredada a su membresía canónica.
--
-- En el código ya no la escribe nadie (T-127 retiró las cuatro escrituras de
-- `salonController`) y ya no la lee nadie: las lecturas se migraron en E-02b y
-- E-02c, y la última que quedaba (una herramienta de Aura) se corrigió antes de
-- E-04.
--
-- ESTA MIGRACIÓN NO BORRA A CIEGAS
-- Antes de soltar la tabla comprueba que **cada fila heredada tenga su membresía
-- canónica**. Si encuentra una sola sin equivalente, aborta con error y no toca
-- nada: es preferible un despliegue rojo a perder una pertenencia.
--
-- Idempotente: si la tabla no existe, no hace nada.

BEGIN;

DO $$
DECLARE
  huerfanas integer;
  total integer;
BEGIN
  IF to_regclass('public.salon_miembros') IS NULL THEN
    RAISE NOTICE 'T-127: salon_miembros no existe; nada que retirar.';
    RETURN;
  END IF;

  SELECT count(*) INTO total FROM salon_miembros;

  SELECT count(*) INTO huerfanas
    FROM salon_miembros sm
   WHERE NOT EXISTS (
           SELECT 1
             FROM memberships m
            WHERE m.user_id = sm.user_id
              AND m.business_profile_id = left('salon-' || sm.salon_id::text, 36)
         );

  IF huerfanas > 0 THEN
    RAISE EXCEPTION
      'T-127 abortado: hay % de % filas en salon_miembros sin membresía canónica. Ejecute la migración 113 y revise antes de retirar la tabla.',
      huerfanas, total;
  END IF;

  RAISE NOTICE 'T-127: % filas heredadas, todas con membresía canónica. Se retira la tabla.', total;

  -- Sin FK entrantes, sin vistas y sin funciones que la usen (comprobado en la
  -- base real): CASCADE no arrastra nada más.
  DROP TABLE salon_miembros CASCADE;
END $$;

COMMIT;

-- 189_explicit_salon_business_profile.sql
-- Fase 1: relación explícita entre una sede operativa (salones) y su perfil SaaS.
--
-- Antes, esta relación dependía de reconstruir el texto `salon-<id>` en cada
-- consulta. La columna es nullable durante la transición: los perfiles no
-- provisionados se deben reparar antes de imponer NOT NULL.
-- No se modifica `salones.tenant_id` (INTEGER -> tenants.id): es un identificador
-- legado distinto de `business_profiles.tenant_id` (VARCHAR) y de
-- `memberships.business_profile_id`.

BEGIN;

ALTER TABLE salones
  ADD COLUMN IF NOT EXISTS business_profile_id VARCHAR(36);

-- Conserva asignaciones explícitas previas; solo completa las sedes sin vínculo
-- mediante el mapeo histórico que ya usaban las migraciones 113/114.
UPDATE salones s
   SET business_profile_id = bp.id
  FROM business_profiles bp
 WHERE s.business_profile_id IS NULL
   AND bp.id = left('salon-' || s.id::text, 36);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_salones_business_profile'
       AND conrelid = 'public.salones'::regclass
  ) THEN
    ALTER TABLE salones
      ADD CONSTRAINT fk_salones_business_profile
      FOREIGN KEY (business_profile_id)
      REFERENCES business_profiles(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_salones_business_profile_id
  ON salones (business_profile_id)
  WHERE business_profile_id IS NOT NULL;

COMMENT ON COLUMN salones.business_profile_id IS
  'Perfil SaaS canónico del negocio propietario de esta sede; explícito, no derivado del ID de salón.';

COMMIT;

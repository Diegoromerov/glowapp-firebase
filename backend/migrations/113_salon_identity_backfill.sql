-- 113_salon_identity_backfill.sql
-- E-02a (D-GL-027): puente de identidad entre `salones` (SaaS clásico) y
-- `business_profiles` + `memberships` (modelo canónico, migración 082).
--
-- Motivo: `/api/saas/bootstrap` crea el perfil del salón sólo cuando alguien lo
-- llama, así que un salón recién creado no tiene membership y toda la capa SaaS
-- (`req.saas`, entitlements, RBAC) queda vacía. En producción hay 0 perfiles y
-- 0 memberships con 0 salones, así que esta migración no mueve datos: crea el
-- puente y queda lista para el primer salón.
--
-- Idempotente por diseño: `ON CONFLICT` en las dos tablas. Se puede correr dos
-- veces sin duplicar ni perder el rol de un miembro ya migrado.
--
-- Convención de id (la misma que usa saasBootstrapRoutes):
--   business_profiles.id = 'salon-' || salones.id
--   business_profiles.tenant_id = 'tenant-' || salones.id

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Perfil de negocio por salón
-- ---------------------------------------------------------------------------
INSERT INTO business_profiles (
  id, provider_id, vertical_id, name, onboarding_mode, lifecycle_stage,
  compliance_score, city, country, tenant_id, saas_plan
)
SELECT
  left('salon-' || s.id::text, 36),
  s.id_dueno,
  v.id,
  left(COALESCE(NULLIF(trim(s.nombre_salon), ''), 'Salón ' || s.id::text), 150),
  'EXISTING_BUSINESS',
  'OPERATION',
  45.00,
  left(COALESCE(NULLIF(trim(s.ciudad), ''), 'Bogotá'), 100),
  'Colombia',
  left('tenant-' || s.id::text, 64),
  upper(COALESCE(NULLIF(trim(s.plan_saas), ''), 'FREE_TRIAL'))
FROM salones s
-- Vertical de belleza si existe; si no, cualquiera. Si no hay ninguna, el
-- CROSS JOIN devuelve 0 filas y la migración no inserta (no falla).
CROSS JOIN LATERAL (
  SELECT id FROM business_verticals
  ORDER BY (CASE WHEN code ILIKE '%BELLEZA%' OR code ILIKE '%BELL%' THEN 0 ELSE 1 END), name ASC
  LIMIT 1
) v
ON CONFLICT (id) DO UPDATE SET
  name       = EXCLUDED.name,
  city       = COALESCE(business_profiles.city, EXCLUDED.city),
  tenant_id  = COALESCE(NULLIF(business_profiles.tenant_id, 'default'), EXCLUDED.tenant_id),
  updated_at = CURRENT_TIMESTAMP;

-- ---------------------------------------------------------------------------
-- 2. Membresías: el dueño del salón + cada miembro activo
--    Mapeo de sub_rol (texto libre, sin CHECK) al rol canónico de `memberships`.
--      DUEÑO / DUENO                -> OWNER
--      ADMINISTRADOR / ADMIN        -> ADMIN
--      RECEPCIONISTA                -> MANAGER   (R-1: no se crea rol nuevo)
--      PRESTADOR_INDEPENDIENTE      -> MEMBER
--      EMPLEADO / otro              -> MEMBER
-- ---------------------------------------------------------------------------
INSERT INTO memberships (
  id, user_id, business_profile_id, role, status, accepted_at, created_by_user_id
)
SELECT
  md5(random()::text || clock_timestamp()::text || x.user_id::text || x.salon_id::text),
  x.user_id,
  left('salon-' || x.salon_id::text, 36),
  x.role,
  'ACTIVE',
  CURRENT_TIMESTAMP,
  x.created_by
FROM (
  -- Un miembro puede venir dos veces (id_dueno + fila DUEÑO en salon_miembros).
  -- Postgres rechaza el ON CONFLICT DO UPDATE si el mismo par (user,business)
  -- aparece dos veces en la MISMA sentencia, así que se deduplica antes:
  -- gana la fila del dueño (prio 0).
  SELECT DISTINCT ON (u.salon_id, u.user_id)
    u.salon_id, u.user_id, u.role, u.created_by
  FROM (
    -- El dueño siempre es OWNER, aunque no tenga fila en salon_miembros
    SELECT s.id AS salon_id, s.id_dueno AS user_id, 'OWNER' AS role, s.id_dueno AS created_by, 0 AS prio
    FROM salones s
    UNION ALL
    SELECT
      sm.salon_id,
      sm.user_id,
      CASE upper(trim(sm.sub_rol))
        WHEN 'DUEÑO' THEN 'OWNER'
        WHEN 'DUENO' THEN 'OWNER'
        WHEN 'ADMINISTRADOR' THEN 'ADMIN'
        WHEN 'ADMIN' THEN 'ADMIN'
        WHEN 'RECEPCIONISTA' THEN 'MANAGER'
        WHEN 'PRESTADOR_INDEPENDIENTE' THEN 'MEMBER'
        WHEN 'EMPLEADO' THEN 'MEMBER'
        ELSE 'MEMBER'
      END,
      s.id_dueno,
      1 AS prio
    FROM salon_miembros sm
    JOIN salones s ON s.id = sm.salon_id
    WHERE sm.estatus = 'ACTIVO'
  ) u
  ORDER BY u.salon_id, u.user_id, u.prio ASC
) x
JOIN business_profiles bp ON bp.id = left('salon-' || x.salon_id::text, 36)
ON CONFLICT (user_id, business_profile_id) DO UPDATE SET
  role       = EXCLUDED.role,
  status     = 'ACTIVE',
  accepted_at = COALESCE(memberships.accepted_at, CURRENT_TIMESTAMP),
  updated_at = CURRENT_TIMESTAMP;

COMMIT;

-- 114_memberships_sub_rol.sql
-- E-02b (D-GL-027): `memberships` pasa a ser la fuente de lectura de los
-- miembros del salón.
--
-- `memberships.role` tiene cinco valores canónicos (OWNER, ADMIN, MANAGER,
-- MEMBER, VIEWER) y no distingue PRESTADOR_INDEPENDIENTE de EMPLEADO: los dos
-- caen en MEMBER. El SaaS muestra y edita el `sub_rol` heredado, así que sin
-- esta columna la etiqueta se perdería en la primera lectura desde memberships.
--
-- `role` sigue siendo la verdad de autorización; `sub_rol` es la etiqueta de
-- presentación y compatibilidad con el cliente Flutter.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS y UPDATE sólo donde falta.

BEGIN;

ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS sub_rol VARCHAR(50);

-- Relleno desde la tabla heredada, sólo para las memberships que aún no lo
-- tienen. El perfil del salón se resuelve por la convención 'salon-<id>'.
UPDATE memberships m
   SET sub_rol = upper(trim(sm.sub_rol))
  FROM salon_miembros sm
 WHERE m.business_profile_id = left('salon-' || sm.salon_id::text, 36)
   AND m.user_id = sm.user_id
   AND m.sub_rol IS NULL;

-- Etiqueta por defecto cuando no hay fila heredada: se deriva del rol canónico.
UPDATE memberships
   SET sub_rol = CASE role
                   WHEN 'OWNER'   THEN 'DUEÑO'
                   WHEN 'ADMIN'   THEN 'ADMINISTRADOR'
                   WHEN 'MANAGER' THEN 'RECEPCIONISTA'
                   ELSE 'EMPLEADO'
                 END
 WHERE sub_rol IS NULL
   AND business_profile_id LIKE 'salon-%';

COMMIT;

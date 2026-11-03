-- ============================================================================
-- 070_reassign_tenant_id_by_owner.sql
-- A360-2026-09-22/C-10 — El backfill histórico asignó TODO al tenant `demo`.
--
-- POR QUÉ UNA MIGRACIÓN NUEVA Y NO UNA REESCRITURA DE LA 057:
--   La 057 YA se ejecutó en producción: `UPDATE ... WHERE tenant_id IS NULL` no vuelve
--   a encontrar filas, así que reescribirla no reasigna nada. Y con el registro
--   `schema_migrations` que ahora existe, una migración ya aplicada no se re-ejecuta
--   nunca. Por eso el arreglo va aquí, con conteos antes y después.
--
-- ¿POR QUÉ EN migrations/manual/? Es una migración de DATOS sobre producción.
--   No debe dispararse automáticamente en cada arranque del backend.
--   Orden: (1) BACKUP, (2) medir, (3) ejecutar dentro de una transacción, (4) verificar.
--
-- IDEMPOTENTE respecto al resultado: solo toca filas que siguen en el tenant `demo`
-- y cuyo dueño real puede determinarse.
-- ============================================================================

-- ---- 0. MEDICIÓN PREVIA (ejecutar y guardar la salida) --------------------
-- SELECT tenant_id, count(*) FROM usuarios GROUP BY tenant_id ORDER BY 2 DESC;
-- SELECT tenant_id, count(*) FROM bookings GROUP BY tenant_id ORDER BY 2 DESC;

BEGIN;

-- 1) Usuarios: el dueño de un salón manda su propio tenant.
--    (salones.id_dueno es el id del usuario; columna confirmada en el repositorio.)
WITH dueno AS (
  SELECT s.id_dueno AS user_id, s.tenant_id
  FROM salones s
  WHERE s.id_dueno IS NOT NULL AND s.tenant_id IS NOT NULL
)
UPDATE usuarios u
   SET tenant_id = d.tenant_id
  FROM dueno d
 WHERE u.id = d.user_id;

-- 2) Miembros de un salón: heredan el tenant del salón al que pertenecen.
WITH miembro AS (
  SELECT m.user_id, s.tenant_id
  FROM salon_miembros m
  JOIN salones s ON s.id = m.salon_id
  WHERE s.tenant_id IS NOT NULL
)
UPDATE usuarios u
   SET tenant_id = m.tenant_id
  FROM miembro m
 WHERE u.id = m.user_id;

-- 3) bookings / transactions / servicios: heredan el tenant del cliente,
--    o el del prestador si el cliente no se puede determinar.
UPDATE bookings b
   SET tenant_id = u.tenant_id
  FROM usuarios u
 WHERE b.client_id = u.id AND u.tenant_id IS NOT NULL
   AND (b.tenant_id IS NULL OR b.tenant_id IN (SELECT id FROM tenants WHERE slug = 'demo'));

UPDATE bookings b
   SET tenant_id = u.tenant_id
  FROM usuarios u
 WHERE b.provider_id = u.id AND u.tenant_id IS NOT NULL
   AND (b.tenant_id IS NULL OR b.tenant_id IN (SELECT id FROM tenants WHERE slug = 'demo'));

UPDATE transactions t
   SET tenant_id = b.tenant_id
  FROM bookings b
 WHERE t.booking_id = b.id AND b.tenant_id IS NOT NULL
   AND (t.tenant_id IS NULL OR t.tenant_id IN (SELECT id FROM tenants WHERE slug = 'demo'));

UPDATE servicios s2
   SET tenant_id = u.tenant_id
  FROM usuarios u
 WHERE s2.prestador_id = u.id AND u.tenant_id IS NOT NULL
   AND (s2.tenant_id IS NULL OR s2.tenant_id IN (SELECT id FROM tenants WHERE slug = 'demo'));

COMMIT;

-- ---- 4. MEDICIÓN POSTERIOR Y CONTROL --------------------------------
-- Debe bajar el conteo del tenant 'demo'. Lo que QUEDE en demo es lo que no se pudo
-- atribuir por dueño: es una decisión de negocio (depurar, marcar como legacy o
-- dejar en un tenant de cuarentena), NO un borrado silencioso.
-- SELECT t.slug, count(*) FROM usuarios u
--   LEFT JOIN tenants t ON t.id = u.tenant_id GROUP BY 1 ORDER BY 2 DESC;
-- Debe devolver 0 filas:
-- SELECT count(*) FROM bookings b JOIN tenants t ON t.id = b.tenant_id
--   WHERE t.slug = 'demo' AND b.created_at > NOW() - INTERVAL '30 days';

-- ============================================================
-- MIGRACIÓN 112: columnas de invitación en memberships
-- ============================================================
-- Motivo: backend/src/routes/saasTeamRoutes.js escribe `invite_token`,
-- `invited_by` y `status = 'PENDING'`, pero la migración 082 no creó esas
-- columnas y su CHECK de status solo permitía
-- ('INVITED','ACTIVE','SUSPENDED','REVOKED'). Resultado: invitar/aceptar
-- miembros fallaba con "column does not exist" o violación de CHECK.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS y un
-- índice parcial único. Re-ejecutar es no-op.
-- ============================================================

ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS invite_token VARCHAR(64),
  ADD COLUMN IF NOT EXISTS invited_by INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP WITH TIME ZONE;

-- Relajar el CHECK de status para aceptar 'PENDING' (usado por las rutas)
-- junto con los valores originales.
DO $$
BEGIN
  ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_status_check;
  ALTER TABLE memberships
    ADD CONSTRAINT memberships_status_check
    CHECK (status IN ('PENDING', 'INVITED', 'ACTIVE', 'SUSPENDED', 'REVOKED'));
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'No se pudo recrear memberships_status_check: %', SQLERRM;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_invite_token
  ON memberships(invite_token)
  WHERE invite_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_memberships_status
  ON memberships(status);

-- ------------------------------------------------------------
-- Vertical por defecto: `business_verticals` está VACÍA en producción
-- (verificado: 0 filas) y `business_profiles.vertical_id` es NOT NULL con FK.
-- Sin una vertical, el provisionamiento del tenant falla siempre.
-- ------------------------------------------------------------
INSERT INTO business_verticals (id, code, name, description)
SELECT 'vert-belleza', 'BELLEZA', 'Belleza y estética',
       'Salones de belleza, barberías, spas y estética'
WHERE NOT EXISTS (SELECT 1 FROM business_verticals WHERE code = 'BELLEZA')
  AND NOT EXISTS (SELECT 1 FROM business_verticals);


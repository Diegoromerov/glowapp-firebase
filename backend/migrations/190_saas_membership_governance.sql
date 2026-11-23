-- Fase 3: membresías canónicas, invitaciones seguras y auditoría.
-- Compatible con las filas actuales: no migra ni elimina membresías existentes.
BEGIN;

ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS invite_email VARCHAR(254),
  ADD COLUMN IF NOT EXISTS invite_token_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS removed_by INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;

DO $$
BEGIN
  ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_status_check;
  ALTER TABLE memberships
    ADD CONSTRAINT memberships_status_check
    CHECK (status IN ('PENDING', 'INVITED', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'REMOVED', 'EXPIRED'));
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_pending_invite_email
  ON memberships (business_profile_id, lower(invite_email))
  WHERE status = 'PENDING' AND invite_email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_invite_token_hash
  ON memberships (invite_token_hash)
  WHERE invite_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS membership_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  business_profile_id VARCHAR(36) NOT NULL REFERENCES business_profiles(id) ON DELETE RESTRICT,
  membership_id VARCHAR(36),
  actor_user_id INTEGER,
  event_type VARCHAR(40) NOT NULL,
  previous_role VARCHAR(20),
  new_role VARCHAR(20),
  previous_status VARCHAR(20),
  new_status VARCHAR(20),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT membership_audit_event_type_check CHECK (
    event_type IN ('INVITED', 'INVITATION_RESENT', 'INVITATION_ACCEPTED', 'INVITATION_EXPIRED', 'ROLE_CHANGED', 'SUSPENDED', 'REACTIVATED', 'REMOVED', 'INVITATION_CANCELLED')
  )
);

CREATE INDEX IF NOT EXISTS idx_membership_audit_tenant_created
  ON membership_audit_logs (business_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_membership_audit_membership_created
  ON membership_audit_logs (membership_id, created_at DESC);

COMMENT ON TABLE membership_audit_logs IS
  'Registro append-only de cambios de rol, estado e invitaciones del equipo SaaS.';
COMMENT ON COLUMN memberships.invite_token_hash IS
  'SHA-256 del token de invitación; el token original solo se entrega en el enlace por correo.';

CREATE OR REPLACE FUNCTION prevent_membership_audit_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'membership_audit_logs es append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_membership_audit_append_only ON membership_audit_logs;
CREATE TRIGGER trg_membership_audit_append_only
  BEFORE UPDATE OR DELETE ON membership_audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_membership_audit_mutation();

COMMIT;

-- 075_create_admin_audit_logs.sql
-- FIX-FLUTTER-10 (P2) — Trazabilidad de acciones sensibles de administración.
--
-- Hallazgo: el panel admin del módulo Business
-- (admin-dashboard/src/app/business/page.tsx:99-128 -> handleReview Aprobar/
-- Rechazar, y :131-165 -> handleGenerateDocument) ejecuta acciones sobre
-- PUT /api/v1/business/admin/evidence/:id y POST /api/v1/business/documents/generate
-- sin dejar ningún registro persistente de QUIÉN hizo qué, CUÁNDO, sobre qué
-- recurso y desde qué IP/user-agent.
--
-- Esta tabla es APPEND-ONLY: el middleware src/middleware/adminAuditLog.js solo
-- inserta; un trigger bloquea UPDATE/DELETE y se revocan los privilegios de
-- mutación a los roles de aplicación (defensa en profundidad).

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     VARCHAR(64)  NOT NULL,
  action      VARCHAR(100) NOT NULL,
  resource    VARCHAR(128) NOT NULL,
  resource_id VARCHAR(128),
  method      VARCHAR(10),
  path        TEXT,
  status_code INTEGER,
  ip          VARCHAR(64),
  user_agent  TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_user    ON admin_audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action  ON admin_audit_logs(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_resource ON admin_audit_logs(resource, resource_id);

-- Append-only: cualquier intento de modificar o borrar una fila falla.
CREATE OR REPLACE FUNCTION admin_audit_logs_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_logs es append-only: % no permitido', TG_OP
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_admin_audit_logs_append_only ON admin_audit_logs;
CREATE TRIGGER trg_admin_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON admin_audit_logs
  FOR EACH ROW EXECUTE FUNCTION admin_audit_logs_append_only();

-- Defensa en profundidad para los roles de aplicación de este repo.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rls_user') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON admin_audit_logs FROM app_rls_user;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON admin_audit_logs FROM app_owner;
  END IF;
END $$;

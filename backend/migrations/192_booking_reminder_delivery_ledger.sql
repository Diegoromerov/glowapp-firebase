-- Fase 4: registro idempotente de recordatorios de reserva por negocio y canal.
-- El costo queda NULL hasta contar con costo real reportado/configurado por proveedor.
BEGIN;

CREATE TABLE IF NOT EXISTS booking_reminder_deliveries (
  id BIGSERIAL PRIMARY KEY,
  business_profile_id VARCHAR(36) NOT NULL REFERENCES business_profiles(id) ON DELETE RESTRICT,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  reminder_kind VARCHAR(40) NOT NULL,
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('PUSH', 'EMAIL')),
  provider VARCHAR(40) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED')),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  provider_message_id VARCHAR(255),
  error_code VARCHAR(80),
  cost_amount NUMERIC(12,6),
  cost_currency CHAR(3),
  cost_source VARCHAR(40),
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  CONSTRAINT uq_booking_reminder_delivery UNIQUE (booking_id, reminder_kind, channel),
  CONSTRAINT chk_reminder_cost CHECK (
    (cost_amount IS NULL AND cost_currency IS NULL)
    OR (cost_amount >= 0 AND cost_currency IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_booking_reminder_business_time
  ON booking_reminder_deliveries (business_profile_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_reminder_booking
  ON booking_reminder_deliveries (booking_id, reminder_kind);

ALTER TABLE booking_reminder_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_reminder_deliveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_booking_reminder_deliveries ON booking_reminder_deliveries;
CREATE POLICY tenant_isolation_booking_reminder_deliveries
  ON booking_reminder_deliveries
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM memberships m
     WHERE m.business_profile_id = booking_reminder_deliveries.business_profile_id
       AND m.user_id = app_current_user_id()
       AND m.status = 'ACTIVE'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM memberships m
     WHERE m.business_profile_id = booking_reminder_deliveries.business_profile_id
       AND m.user_id = app_current_user_id()
       AND m.status = 'ACTIVE'
  ));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rls_user') THEN
    GRANT SELECT ON booking_reminder_deliveries TO app_rls_user;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_system') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON booking_reminder_deliveries TO app_system;
    GRANT USAGE, SELECT ON SEQUENCE booking_reminder_deliveries_id_seq TO app_system;
  END IF;
END $$;

COMMENT ON TABLE booking_reminder_deliveries IS
  'Conteo/costo observado de recordatorios transaccionales de reservas, separado de las cuotas SaaS; una fila por reserva, tipo y canal.';
COMMENT ON COLUMN booking_reminder_deliveries.cost_amount IS
  'Costo unitario real reportado por proveedor; NULL significa que no está disponible y no se estima.';

COMMIT;

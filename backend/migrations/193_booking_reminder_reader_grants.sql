-- Restringe los privilegios directos de la app RLS sobre el ledger.
-- 192 daba SELECT, pero los privilegios por defecto del esquema concedían
-- también escrituras; revoca explícitamente antes de dejar lectura.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rls_user') THEN
    REVOKE ALL PRIVILEGES ON TABLE booking_reminder_deliveries FROM app_rls_user;
    GRANT SELECT ON TABLE booking_reminder_deliveries TO app_rls_user;
    REVOKE ALL PRIVILEGES ON SEQUENCE booking_reminder_deliveries_id_seq FROM app_rls_user;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_system') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE booking_reminder_deliveries TO app_system;
    GRANT USAGE, SELECT ON SEQUENCE booking_reminder_deliveries_id_seq TO app_system;
  END IF;
END $$;

COMMIT;

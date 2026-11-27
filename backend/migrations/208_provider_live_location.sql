-- Current consented foreground location only. No location history is retained.
ALTER TABLE perfiles_prestador
  ADD COLUMN IF NOT EXISTS live_location_consent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS live_location_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS live_location_consent_version VARCHAR(32);

CREATE TABLE IF NOT EXISTS provider_live_locations (
  provider_id INTEGER PRIMARY KEY REFERENCES perfiles_prestador(id) ON DELETE CASCADE,
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  accuracy_meters REAL NOT NULL CHECK (accuracy_meters >= 0 AND accuracy_meters <= 100),
  captured_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- La ubicación actual puede ser escrita y eliminada por su propietario.
-- El directorio cross-tenant y la retención usan runAsSystem/app_system.
ALTER TABLE provider_live_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_live_locations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_live_locations_owner ON provider_live_locations;
CREATE POLICY provider_live_locations_owner ON provider_live_locations
  FOR ALL TO app_rls_user
  USING (provider_id = app_current_user_id())
  WITH CHECK (provider_id = app_current_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rls_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON provider_live_locations TO app_rls_user;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_system') THEN
    GRANT SELECT, DELETE ON provider_live_locations TO app_system;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_provider_live_locations_location
  ON provider_live_locations USING GIST (location);

CREATE INDEX IF NOT EXISTS idx_provider_live_locations_received_at
  ON provider_live_locations (received_at);

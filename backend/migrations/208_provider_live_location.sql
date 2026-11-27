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

CREATE INDEX IF NOT EXISTS idx_provider_live_locations_location
  ON provider_live_locations USING GIST (location);

CREATE INDEX IF NOT EXISTS idx_provider_live_locations_received_at
  ON provider_live_locations (received_at);

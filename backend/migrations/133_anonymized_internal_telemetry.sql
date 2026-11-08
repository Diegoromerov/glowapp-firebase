-- 133: telemetría interna agregable, sin identificadores de usuario ni metadatos libres.
BEGIN;

ALTER TABLE analytics_events ALTER COLUMN user_id DROP NOT NULL;
-- La carga histórica podía contener IDs, productos, montos y otros metadatos libres.
-- Se conserva únicamente un nombre de pantalla de forma controlada para agregación.
UPDATE analytics_events
   SET user_id = NULL,
       metadata = CASE
         WHEN metadata->>'screen_name' ~ '^/[A-Za-z0-9_./-]{1,100}$'
           THEN jsonb_build_object('screen_name', metadata->>'screen_name')
         ELSE '{}'::jsonb
       END;

CREATE INDEX IF NOT EXISTS idx_analytics_events_occurred_at
  ON analytics_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_type_date
  ON analytics_events (event_type, occurred_at DESC);

COMMENT ON TABLE analytics_events IS
  'Eventos mínimos para métricas internas agregadas; user_id debe quedar NULL y metadata solo puede incluir screen_name allowlisted.';

COMMIT;

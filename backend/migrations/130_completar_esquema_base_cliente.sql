-- 130 — Completar el esquema de una base nueva sin arrastrar el árbol SaaS
--
-- POR QUÉ EXISTE
-- --------------
-- Una base construida con la lista del entrypoint quedaba sin `webhook_events`
-- (donde se registran los eventos de Wompi) y sin tres columnas que producción
-- sí tiene. La alternativa era meter 110/111 completas —SaaS billing— y esas
-- arrastran `subscriptions`, `usage_metrics` y su propia cadena: para conseguir
-- una tabla, se importaba medio producto que el cliente no usa.
--
-- IDEMPOTENTE: CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS webhook_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        VARCHAR(20) NOT NULL CHECK (provider IN ('stripe','wompi')),
  event_id        VARCHAR(255) NOT NULL,
  event_type      VARCHAR(100) NOT NULL,
  payload_hash    VARCHAR(64) NOT NULL,
  processed_at    TIMESTAMPTZ DEFAULT NOW(),
  result          JSONB DEFAULT '{}'::jsonb,
  error_message   TEXT
);

-- El registrador usa ON CONFLICT (provider, event_id): sin este índice único,
-- un reintento de Wompi insertaría duplicados o fallaría.
CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_provider_event_id_key
  ON webhook_events (provider, event_id);

ALTER TABLE beauty_profiles      ADD COLUMN IF NOT EXISTS entry_point VARCHAR(50) DEFAULT 'ideas';
ALTER TABLE biometric_access_log ADD COLUMN IF NOT EXISTS endpoint    VARCHAR(255);
ALTER TABLE biometric_access_log ADD COLUMN IF NOT EXISTS user_agent  TEXT;

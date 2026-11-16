-- 164_extend_webhook_events_envia.sql
-- Migración F1-Logística: Extender webhook_events para tracking Envíame + idempotencia

-- La tabla webhook_events ya existe (creada en migración anterior para Wompi)
-- Añadimos campos específicos para Envíame y mejoramos idempotencia

-- 0. El CHECK original solo admitía los webhooks de pago ('stripe','wompi');
--    sin ensancharlo, cualquier evento de carrier falla al registrarse.
--    Se localiza el constraint por definición (no por nombre) para no depender
--    de cómo lo nombró la base, y se vuelve a crear con la lista completa.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'webhook_events'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%provider%'
  LOOP
    EXECUTE format('ALTER TABLE webhook_events DROP CONSTRAINT %I', c.conname);
  END LOOP;

  ALTER TABLE webhook_events ADD CONSTRAINT webhook_events_provider_check
    CHECK (provider IN ('stripe','wompi','envia','inter','coordinadora','servientrega','tcc','envia_472'));
END $$;

ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS provider VARCHAR(50) NOT NULL DEFAULT 'wompi',  -- 'wompi', 'envia', 'inter', 'coordinadora', etc.
  ADD COLUMN IF NOT EXISTS evento_tipo VARCHAR(100),                        -- 'shipment.status_update', 'pickup.scheduled', etc.
  ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(100),                    -- Número de guía (Envíame/carrier)
  ADD COLUMN IF NOT EXISTS shipment_id VARCHAR(100),                        -- ID de envío en Envíame
  ADD COLUMN IF NOT EXISTS payload_previo_hash VARCHAR(64),                 -- SHA256 del payload anterior (para detectar duplicados con mismo event_id pero distinto contenido)
  ADD COLUMN IF NOT EXISTS procesado_ok BOOLEAN DEFAULT NULL,               -- NULL=pendiente, true=ok, false=error
  ADD COLUMN IF NOT EXISTS error_mensaje TEXT,
  ADD COLUMN IF NOT EXISTS reintentos INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS procesado_en TIMESTAMPTZ;

-- Índices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_webhook_events_provider ON webhook_events(provider);
CREATE INDEX IF NOT EXISTS idx_webhook_events_tracking ON webhook_events(tracking_number) WHERE tracking_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_webhook_events_shipment ON webhook_events(shipment_id) WHERE shipment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_webhook_events_pendientes ON webhook_events(procesado_ok) WHERE procesado_ok IS NULL;

-- Constraint de idempotencia mejorada: provider + event_id + payload_hash únicos
-- (Un mismo event_id puede llegar con payload distinto en reintentos; si payload igual, es duplicado exacto)
CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_events_idempotencia
  ON webhook_events(provider, event_id, payload_previo_hash)
  WHERE event_id IS NOT NULL AND payload_previo_hash IS NOT NULL;

-- Comentarios
COMMENT ON COLUMN webhook_events.provider IS 'Fuente del webhook: wompi, envia, inter, coordinadora, servientrega, tcc, etc.';
COMMENT ON COLUMN webhook_events.evento_tipo IS 'Tipo de evento específico del provider (ej: shipment.status_update, pickup.created)';
COMMENT ON COLUMN webhook_events.tracking_number IS 'Número de guía/rastreo del carrier';
COMMENT ON COLUMN webhook_events.shipment_id IS 'ID del envío en Envíame (si aplica)';
COMMENT ON COLUMN webhook_events.payload_previo_hash IS 'SHA256 del payload para detectar duplicados exactos en reintentos';
COMMENT ON COLUMN webhook_events.procesado_ok IS 'NULL=pendiente procesamiento, true=procesado ok, false=error tras reintentos';
COMMENT ON COLUMN webhook_events.reintentos IS 'Número de veces que se intentó procesar este webhook';
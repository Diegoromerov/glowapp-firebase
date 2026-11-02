-- ============================================================
-- MIGRACIÓN 074: Ledger wallet_transactions APPEND-ONLY
-- Hallazgo P0 · AUD-SEGPAGOS-01 · P0-02 (inmutabilidad violada)
--
-- La migración 001 declara el ledger como inmutable ("esta tabla NUNCA se
-- actualiza, solo se inserta"), pero el código de producción emitía 6
-- sentencias UPDATE sobre wallet_transactions. Esta migración:
--
--   1. Instala un trigger que ABORTA cualquier UPDATE/DELETE/TRUNCATE sobre
--      wallet_transactions (garantía append-only a nivel de motor).
--   2. Crea la tabla append-only `wallet_ledger_events` donde se registran los
--      cambios de ciclo de vida (maduración, acreditación, desenlace de retiro)
--      que antes mutaban el asiento contable.
--   3. Reconstruye (backfill) los eventos históricos a partir del estado actual.
--
-- Re-ejecutable (idempotente): DROP TRIGGER IF EXISTS + CREATE OR REPLACE
-- FUNCTION + IF NOT EXISTS + NOT EXISTS en el backfill.
-- ============================================================

BEGIN;

-- ─── 1. Garantía append-only ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION enforce_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'La tabla % es un ledger append-only: la operación % no está permitida. Registre el cambio como un nuevo evento (ver wallet_ledger_events).',
    TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wallet_transactions_append_only ON wallet_transactions;
CREATE TRIGGER trg_wallet_transactions_append_only
  BEFORE UPDATE OR DELETE ON wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only();

DROP TRIGGER IF EXISTS trg_wallet_transactions_no_truncate ON wallet_transactions;
CREATE TRIGGER trg_wallet_transactions_no_truncate
  BEFORE TRUNCATE ON wallet_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION enforce_append_only();

-- ─── 2. Tabla append-only de eventos del ledger ──────────────────────────────

CREATE TABLE IF NOT EXISTS wallet_ledger_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_id       UUID NOT NULL REFERENCES wallet_transactions(id) ON DELETE RESTRICT,
  provider_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  evento      VARCHAR(40) NOT NULL
              CHECK (evento IN ('MADURADO','ACREDITADO','RETIRO_COMPLETADO','RETIRO_FALLIDO')),
  detalle     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_events_tx
  ON wallet_ledger_events(tx_id, evento);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_events_provider
  ON wallet_ledger_events(provider_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_wallet_ledger_events_append_only ON wallet_ledger_events;
CREATE TRIGGER trg_wallet_ledger_events_append_only
  BEFORE UPDATE OR DELETE ON wallet_ledger_events
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only();

DROP TRIGGER IF EXISTS trg_wallet_ledger_events_no_truncate ON wallet_ledger_events;
CREATE TRIGGER trg_wallet_ledger_events_no_truncate
  BEFORE TRUNCATE ON wallet_ledger_events
  FOR EACH STATEMENT EXECUTE FUNCTION enforce_append_only();

-- ─── 3. Backfill de eventos históricos ───────────────────────────────────────
-- Créditos ya acreditados antes de esta migración.
INSERT INTO wallet_ledger_events (tx_id, provider_id, evento, detalle, created_at)
SELECT wt.id, wt.provider_id, 'ACREDITADO', jsonb_build_object('monto', wt.monto),
       COALESCE(wt.created_at, NOW())
FROM wallet_transactions wt
WHERE wt.tipo IN ('CREDITO_SERVICIO', 'CREDITO_PRODUCTO')
  AND wt.estado = 'COMPLETADO'
  AND (wt.metadata->>'acreditado') = 'true'
  AND NOT EXISTS (
    SELECT 1 FROM wallet_ledger_events e
    WHERE e.tx_id = wt.id AND e.evento = 'ACREDITADO'
  );

-- Desenlaces de retiro ya resueltos antes de esta migración.
INSERT INTO wallet_ledger_events (tx_id, provider_id, evento, detalle, created_at)
SELECT wt.id, wt.provider_id,
       CASE WHEN wt.estado = 'COMPLETADO' THEN 'RETIRO_COMPLETADO' ELSE 'RETIRO_FALLIDO' END,
       COALESCE(wt.metadata, '{}'::jsonb),
       COALESCE(wt.created_at, NOW())
FROM wallet_transactions wt
WHERE wt.tipo = 'DEBITO_RETIRO'
  AND wt.estado IN ('COMPLETADO', 'FALLIDO')
  AND NOT EXISTS (
    SELECT 1 FROM wallet_ledger_events e
    WHERE e.tx_id = wt.id AND e.evento IN ('RETIRO_COMPLETADO', 'RETIRO_FALLIDO')
  );

COMMIT;

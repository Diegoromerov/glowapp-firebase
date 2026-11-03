-- Rollback de 074_wallet_transactions_append_only.sql
-- ADVERTENCIA: destruye los eventos de ciclo de vida del ledger registrados en
-- wallet_ledger_events. Antes de ejecutarlo en producción, exporte la tabla.
BEGIN;

DROP TRIGGER IF EXISTS trg_wallet_transactions_append_only ON wallet_transactions;
DROP TRIGGER IF EXISTS trg_wallet_transactions_no_truncate ON wallet_transactions;
DROP TRIGGER IF EXISTS trg_wallet_ledger_events_append_only ON wallet_ledger_events;
DROP TRIGGER IF EXISTS trg_wallet_ledger_events_no_truncate ON wallet_ledger_events;

DROP TABLE IF EXISTS wallet_ledger_events;

DROP FUNCTION IF EXISTS enforce_append_only();

COMMIT;

-- 095_extend_transactions_for_store_orders.sql
-- Las ventas de la tienda no cabian en `transactions`.
--
-- `payOrder` (orderController.js) inserta una transaccion por cada pago de pedido con
-- columnas (client_id, provider_id, monto_total, comision_plataforma, monto_neto_prestador,
-- impuestos_retencion, pasarela_pago, referencia_pasarela, estado_pago, liberado_al_prestador)
-- que NINGUNA migracion habia creado: en produccion la tabla tenia solo 8 columnas y
-- `booking_id` era NOT NULL, asi que una venta de tienda no cabia. El sintoma real:
--
--   error: column "client_id" of relation "transactions" does not exist
--
-- y todo pago de tienda caia con 500 despues de haber creado el pedido.
--
-- Todo es aditivo e idempotente: no se borra ni se reescribe ningun dato existente.

ALTER TABLE IF EXISTS transactions
  ADD COLUMN IF NOT EXISTS client_id             INTEGER,
  ADD COLUMN IF NOT EXISTS provider_id           INTEGER,
  ADD COLUMN IF NOT EXISTS monto_total           NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS comision_plataforma   NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monto_neto_prestador  NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS impuestos_retencion   NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pasarela_pago         VARCHAR(30),
  ADD COLUMN IF NOT EXISTS referencia_pasarela   VARCHAR(255),
  ADD COLUMN IF NOT EXISTS estado_pago           VARCHAR(30),
  ADD COLUMN IF NOT EXISTS liberado_al_prestador BOOLEAN DEFAULT FALSE;

-- Una venta de tienda no tiene reserva asociada: booking_id deja de ser obligatorio.
-- No afecta a las reservas (siguen insertandolo) ni modifica ninguna fila.
ALTER TABLE IF EXISTS transactions ALTER COLUMN booking_id DROP NOT NULL;

-- El webhook busca la transaccion por `external_id` en cada evento.
CREATE INDEX IF NOT EXISTS idx_transactions_external_id ON transactions (external_id);

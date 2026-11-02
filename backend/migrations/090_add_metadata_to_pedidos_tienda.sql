-- Migración 090: Agregar columna metadata a pedidos_tienda para tracking de pagos Wompi
-- Necesaria para vincular el external_id de la transacción al pedido y conciliar en el webhook

ALTER TABLE pedidos_tienda
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN pedidos_tienda.metadata IS
  'Metadatos del pedido: wompi_external_id para conciliación webhook, tracking de envío, etc.';
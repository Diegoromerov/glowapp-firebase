-- Add optional product shipping weight used by fulfillment.
-- Existing and new rows may leave it NULL; fulfillment defaults to 0.5 kg.
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS peso_kg NUMERIC(8,3);

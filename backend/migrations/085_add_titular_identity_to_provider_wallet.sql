-- 085_add_titular_identity_to_provider_wallet.sql
--
-- MOTIVO (bloqueante para dispersiones reales con Wompi):
-- El endpoint POST/PUT /api/wallet/bank-account recibe `titular_nombre`,
-- `titular_documento_tipo` y `titular_documento_num` desde la app, pero NO los
-- persistía: solo los escribía en el audit_log. La API de Pagos a Terceros de
-- Wompi exige, por cada transacción del lote, `name`, `legalIdType` y `legalId`
-- del beneficiario; sin esos datos guardados es imposible construir el lote sin
-- inventarlos.
--
-- Idempotente: el runner aplica este archivo a producción al desplegar y
-- reintenta si algo falla, así que todo va con IF NOT EXISTS.

ALTER TABLE provider_wallet
  ADD COLUMN IF NOT EXISTS titular_nombre         TEXT,
  ADD COLUMN IF NOT EXISTS titular_documento_tipo TEXT,
  ADD COLUMN IF NOT EXISTS titular_documento_num  TEXT;

COMMENT ON COLUMN provider_wallet.titular_nombre IS
  'Nombre del titular de la cuenta, tal como lo exige Wompi en dispersiones (campo `name`).';
COMMENT ON COLUMN provider_wallet.titular_documento_tipo IS
  'Tipo de documento del titular (CC, NIT, CE, PP, TI, DNI) — campo `legalIdType` de Wompi.';
COMMENT ON COLUMN provider_wallet.titular_documento_num IS
  'Número de documento del titular — campo `legalId` de Wompi.';

-- rollback/085_add_titular_identity_to_provider_wallet.down.sql
-- Revierte 085_add_titular_identity_to_provider_wallet.sql
-- El runner nunca ejecuta rollbacks; esto es para reversión manual.

ALTER TABLE provider_wallet
  DROP COLUMN IF EXISTS titular_nombre,
  DROP COLUMN IF EXISTS titular_documento_tipo,
  DROP COLUMN IF EXISTS titular_documento_num;

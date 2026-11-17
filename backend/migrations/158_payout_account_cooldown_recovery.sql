-- 089_payout_account_cooldown_recovery.sql
-- Mantiene la cuenta anterior aprobada y aplica 24 horas de espera al nuevo destino.
ALTER TABLE provider_wallet
  ADD COLUMN IF NOT EXISTS cuenta_cambio_solicitado_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cuenta_retiros_bloqueados_hasta TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cuenta_anterior_tipo_cuenta VARCHAR(20),
  ADD COLUMN IF NOT EXISTS cuenta_anterior_banco VARCHAR(100),
  ADD COLUMN IF NOT EXISTS cuenta_anterior_numero VARCHAR(30),
  ADD COLUMN IF NOT EXISTS cuenta_anterior_tipo_bancaria VARCHAR(20),
  ADD COLUMN IF NOT EXISTS cuenta_anterior_titular_nombre TEXT,
  ADD COLUMN IF NOT EXISTS cuenta_anterior_documento_tipo TEXT,
  ADD COLUMN IF NOT EXISTS cuenta_anterior_documento_num TEXT,
  ADD COLUMN IF NOT EXISTS cuenta_anterior_verificada BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cuenta_anterior_verificada_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cuenta_anterior_verificada_por INTEGER;

COMMENT ON COLUMN provider_wallet.cuenta_retiros_bloqueados_hasta IS
  'Instante hasta el cual no se permiten retiros después de solicitar un cambio de destino.';

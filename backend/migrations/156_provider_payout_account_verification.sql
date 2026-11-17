-- 087_provider_payout_account_verification.sql
-- Cuenta recién agregada o modificada requiere validación separada antes de retiro.
-- Las cuentas ya verificadas conservan su estado; este cambio solo agrega trazabilidad.

ALTER TABLE provider_wallet
  ADD COLUMN IF NOT EXISTS cuenta_estado_verificacion VARCHAR(24) NOT NULL DEFAULT 'PENDIENTE',
  ADD COLUMN IF NOT EXISTS cuenta_verificada_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cuenta_verificada_por INTEGER;

-- Conservar el estado histórico de cuentas ya aprobadas.
UPDATE provider_wallet
   SET cuenta_estado_verificacion = 'APROBADA'
 WHERE cuenta_verificada = TRUE
   AND cuenta_estado_verificacion = 'PENDIENTE';

ALTER TABLE provider_wallet
  DROP CONSTRAINT IF EXISTS provider_wallet_cuenta_estado_verificacion_check;

ALTER TABLE provider_wallet
  ADD CONSTRAINT provider_wallet_cuenta_estado_verificacion_check
  CHECK (cuenta_estado_verificacion IN ('PENDIENTE', 'APROBADA', 'RECHAZADA'));

COMMENT ON COLUMN provider_wallet.cuenta_estado_verificacion IS
  'Estado de validación de la cuenta de retiro. Solo un proceso administrativo/de verificación puede aprobarla.';
COMMENT ON COLUMN provider_wallet.cuenta_verificada_por IS
  'ID del administrador/servicio que aprobó la cuenta; NULL para registros pendientes.';

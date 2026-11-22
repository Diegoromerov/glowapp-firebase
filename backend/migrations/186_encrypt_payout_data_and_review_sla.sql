-- Cifrado de datos financieros por aplicación (AES-256-GCM) y SLA revisable.
-- Las columnas quedan TEXT para almacenar IV, tag y ciphertext sin truncamiento.
ALTER TABLE provider_wallet
  ALTER COLUMN numero_cuenta TYPE TEXT,
  ALTER COLUMN titular_nombre TYPE TEXT,
  ALTER COLUMN titular_documento_num TYPE TEXT,
  ALTER COLUMN cuenta_anterior_numero TYPE TEXT,
  ALTER COLUMN cuenta_anterior_titular_nombre TYPE TEXT,
  ALTER COLUMN cuenta_anterior_documento_num TYPE TEXT;

ALTER TABLE retiros ALTER COLUMN numero_cuenta TYPE TEXT;

INSERT INTO platform_config (key, value, descripcion)
VALUES ('payout_account_review_sla_hours', '48', 'Plazo objetivo en horas calendario para revisar una cuenta de retiro pendiente.')
ON CONFLICT (key) DO NOTHING;

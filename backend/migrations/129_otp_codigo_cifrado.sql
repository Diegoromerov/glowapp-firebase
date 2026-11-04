-- 129 — Código OTP cifrado para entrega en la app
--
-- El código se guarda hasheado (bcrypt) para verificarlo. Para poder mostrarlo
-- al cliente dentro de la app —y no depender de un proveedor de correo de pago—
-- hace falta poder recuperarlo: se guarda además cifrado con AES-256-GCM y una
-- clave derivada de OTP_ENC_KEY (o JWT_SECRET).
--
-- El hash no sirve para esto: es irreversible por diseño.

ALTER TABLE otp_validaciones
  ADD COLUMN IF NOT EXISTS codigo_cifrado TEXT;

COMMENT ON COLUMN otp_validaciones.codigo_cifrado IS
  'Código OTP cifrado (AES-256-GCM) para mostrarlo al cliente en la app. Solo se descifra en GET /api/bookings/:id/otp.';

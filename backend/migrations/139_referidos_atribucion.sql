-- 139_referidos_atribucion.sql
--
-- El programa de referidos existía a medias: `usuarios.referral_code` y el
-- endpoint /api/auth/referral-info ya devolvían código, enlace y mensaje con el
-- crédito de $10.000 COP, pero nada registraba QUIÉN invitó a quién. El registro
-- ignoraba `?ref=` y no había tabla de conversiones, así que la promesa del
-- mensaje no se podía cumplir ni medir.
--
-- Aquí se guarda la atribución (quién invitó) y la conversión (cuándo ese
-- invitado hizo su primera reserva). El pago del crédito es un paso posterior y
-- separado: esta migración no mueve dinero.

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS referred_by_user_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS referral_converted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS referral_conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  -- UNIQUE: un invitado convierte una sola vez, aunque haga diez reservas.
  invitee_user_id INTEGER NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
  codigo VARCHAR(20),
  booking_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS referral_conversions_referrer
  ON referral_conversions (referrer_user_id, created_at DESC);

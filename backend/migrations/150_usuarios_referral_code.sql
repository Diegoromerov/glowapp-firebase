-- 150_usuarios_referral_code.sql
--
-- Pantalla «Invitar amigas» caída en producción: GET /api/auth/referral-info
-- devolvía 500 con `column "referral_code" does not exist`.
--
-- La migración 139 asumió que `usuarios.referral_code` ya estaba creada por una
-- migración anterior, y no lo estaba: dejó el atributo (`referred_by_user_id`) y
-- la conversión (`referral_converted_at`), pero no el código que se comparte.
-- El controlador lo generaba perezosamente con un UPDATE que nunca llegaba a
-- ejecutarse porque el SELECT anterior ya fallaba.
--
-- Aditiva e idempotente: sólo añade la columna y su unicidad.

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS referral_code TEXT;

-- Unicidad parcial: los NULL no cuentan como duplicados, así que las cuentas
-- que todavía no invitaron a nadie conviven sin problema.
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_referral_code_unico
  ON usuarios (referral_code)
  WHERE referral_code IS NOT NULL;

COMMENT ON COLUMN usuarios.referral_code IS
  'Código que la usuaria comparte para invitar. Se genera en el primer uso (authController).';

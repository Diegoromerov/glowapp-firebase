-- 144_referral_clicks_y_control.sql
--
-- Medición y control del programa (E4).
--
-- 1. `referral_clicks`: el primer escalón del embudo. Sin saber cuántos enlaces
--    se abren no se puede calcular el costo por clienta adquirida ni distinguir
--    el canal bueno del que no convierte. Se guarda el hash de IP y de
--    user-agent, nunca el dato en claro: sirve para detectar granjas de cuentas
--    sin acumular datos personales innecesarios.
--
-- 2. `referral_conversions.estado`: una conversión puede no pagarse. El tope de
--    10 premios por mes (R-05) deja la conversión 11 registrada pero sin puntos,
--    y esa traza es lo que permite explicar el mes sin adivinar. También sirve
--    para dejar una conversión en revisión sin acreditarla.
--
-- Ambas cosas son aditivas: nada de lo existente cambia de forma.

CREATE TABLE IF NOT EXISTS referral_clicks (
    id BIGSERIAL PRIMARY KEY,
    codigo VARCHAR(20) NOT NULL,
    ip_hash TEXT,
    user_agent_hash TEXT,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS referral_clicks_codigo
    ON referral_clicks (codigo, creado_en DESC);

ALTER TABLE referral_conversions
  ADD COLUMN IF NOT EXISTS estado VARCHAR(20) NOT NULL DEFAULT 'ACREDITADA';

ALTER TABLE referral_conversions
  ADD COLUMN IF NOT EXISTS motivo_revision VARCHAR(255);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'referral_conversions_estado_check'
       AND conrelid = 'referral_conversions'::regclass
  ) THEN
    ALTER TABLE referral_conversions
      ADD CONSTRAINT referral_conversions_estado_check
      CHECK (estado IN ('ACREDITADA', 'EN_REVISION', 'TOPE_MENSUAL', 'RECHAZADA'));
  END IF;
END $$;

-- El conteo del tope mensual se hace por referente y por mes: este índice lo
-- mantiene barato incluso cuando la tabla crezca.
CREATE INDEX IF NOT EXISTS referral_conversions_tope_mensual
    ON referral_conversions (referrer_user_id, created_at DESC)
    WHERE estado = 'ACREDITADA';

COMMENT ON TABLE referral_clicks IS
  'Aperturas del enlace de invitación; primer escalón del embudo de referidos';
COMMENT ON COLUMN referral_conversions.estado IS
  'ACREDITADA (pagó puntos), TOPE_MENSUAL (superó los 10 del mes), EN_REVISION, RECHAZADA';

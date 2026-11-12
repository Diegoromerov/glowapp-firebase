-- rollback/144_referral_clicks_y_control.down.sql
--
-- Reversa de 144. Pierde el contador de clics (métrica, no dinero) y el estado
-- de las conversiones.
--
-- OJO: si el código sigue en la versión que escribe `estado` y lee `TOPE_MENSUAL`,
-- bajar esta migración lo rompe. Se baja solo junto con un redeploy del backend
-- anterior; las conversiones y los puntos ya acreditados no se tocan.

DROP INDEX IF EXISTS referral_conversions_tope_mensual;
ALTER TABLE referral_conversions DROP CONSTRAINT IF EXISTS referral_conversions_estado_check;
ALTER TABLE referral_conversions DROP COLUMN IF EXISTS motivo_revision;
ALTER TABLE referral_conversions DROP COLUMN IF EXISTS estado;
DROP INDEX IF EXISTS referral_clicks_codigo;
DROP TABLE IF EXISTS referral_clicks;

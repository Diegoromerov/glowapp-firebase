-- 128 — Token de notificaciones push del usuario
--
-- `authController` registra el token con `UPDATE usuarios SET fcm_token = ...`
-- desde hace tiempo, pero la columna no existía en producción: el registro
-- fallaba en silencio y ninguna push llegaba. Sin esto, el aviso de "tu código
-- de confirmación está listo" no tiene destinatario.

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS fcm_token TEXT;

COMMENT ON COLUMN usuarios.fcm_token IS
  'Token FCM del dispositivo para notificaciones push. Se refresca en cada login.';

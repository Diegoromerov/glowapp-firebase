-- 138_social_shares.sql
--
-- El registro de compartires ya existía (`social_shares_log`, migración 008),
-- pero faltaban tres cosas que hacían que el botón mintiera:
--   1. el CHECK de `platform` no admitía la hoja del sistema (`SISTEMA`), que es
--      el caso real cuando el usuario comparte por WhatsApp o correo: el INSERT
--      reventaba con 500;
--   2. no había forma de impedir el XP repetido: pulsar el botón diez veces
--      insertaba diez filas y «acreditaba» diez veces;
--   3. 008 no está en la lista de migraciones de arranque, así que una base
--      nueva (staging reconstruido, recuperación ante desastre) nacía SIN la
--      tabla y la ruta respondía 500. Se registra allí junto con esta.

ALTER TABLE social_shares_log ADD COLUMN IF NOT EXISTS dia DATE;

UPDATE social_shares_log
   SET dia = (COALESCE(created_at, NOW()) AT TIME ZONE 'utc')::date
 WHERE dia IS NULL;

ALTER TABLE social_shares_log ALTER COLUMN dia SET NOT NULL;

-- El CHECK original pudo quedar con cualquier nombre según cómo se creó la
-- tabla: se busca por definición en lugar de asumirlo.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'social_shares_log'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%platform%'
  LOOP
    EXECUTE format('ALTER TABLE social_shares_log DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE social_shares_log
  ADD CONSTRAINT social_shares_log_platform_check
  CHECK (platform IN ('TIKTOK', 'INSTAGRAM', 'FACEBOOK', 'WHATSAPP', 'SISTEMA'));

-- Un compartir por (usuario, tipo de contenido, referencia) al día. El
-- controlador inserta con ON CONFLICT DO NOTHING: el segundo intento no da XP.
CREATE UNIQUE INDEX IF NOT EXISTS social_shares_dia_unico
  ON social_shares_log (user_id, content_type, COALESCE(share_reference_id, ''), dia);

CREATE INDEX IF NOT EXISTS social_shares_contenido
  ON social_shares_log (content_type, dia);

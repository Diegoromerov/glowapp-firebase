-- 140_producto_compartido.sql
--
-- Compartir un producto de GlowShop es una palanca de venta directa, pero el
-- CHECK de `social_shares_log.content_type` sólo admitía los cuatro tipos
-- originales (colorimetría, VTO, certificado y perfil de prestador). Sin este
-- valor, registrar el share de un producto responde 500 y el usuario ve un
-- error después de haber compartido.

DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'social_shares_log'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%content_type%'
  LOOP
    EXECUTE format('ALTER TABLE social_shares_log DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE social_shares_log
  ADD CONSTRAINT social_shares_log_content_type_check
  CHECK (content_type IN ('AI_COLORIMETRY', 'VTO_LOOK', 'ACADEMY_CERT', 'PROVIDER_PROFILE', 'PRODUCT'));

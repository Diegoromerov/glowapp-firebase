-- Rollback de 086_add_iva_configuration.sql
-- Revierte la configuración de IVA. No hay pérdida de dinero: las columnas de
-- desglose son informativas para la factura, no participan en el cobro.

ALTER TABLE bookings
  DROP COLUMN IF EXISTS subtotal_base,
  DROP COLUMN IF EXISTS iva_valor,
  DROP COLUMN IF EXISTS tarifa_iva_aplicada;

ALTER TABLE usuarios
  DROP CONSTRAINT IF EXISTS chk_usuarios_tarifa_iva_rango;

ALTER TABLE usuarios
  DROP COLUMN IF EXISTS responsable_iva,
  DROP COLUMN IF EXISTS tarifa_iva;

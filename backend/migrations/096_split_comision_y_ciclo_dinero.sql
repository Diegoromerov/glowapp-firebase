-- ============================================================
-- MIGRACIÓN 096: Comisión real desde configuración + ciclo del dinero
-- Fases F1 y F3 del plan de implementación
--
-- F1 — Verdad del dinero
--   El trigger `calc_booking_split` existía en tres definiciones distintas
--   (init.sql, 001 y 011) con porcentajes hardcodeados, y ninguna coincidía
--   con lo medido en producción (12% + 8%). `platform_config.comision_plataforma_pct`
--   se sembraba en 20 pero ningún código la leía.
--
--   Ahora: UNA sola definición. La comisión sale de platform_config y
--   `impuestos_estado` queda en 0 (el 8% era un impuesto inexistente:
--   el RST real de la empresa es 1,6% y no se retiene al prestador).
--
-- F3 — Ciclo del dinero
--   Maduración 48 h (para que cierre la ventana de disputa), enum SEMANAL,
--   anticipado desde 100.000 y 7 días de ciclo estándar.
--
-- Idempotente: CREATE OR REPLACE + IF NOT EXISTS + UPDATE por key.
-- ============================================================

-- ─── 0. Enums (fuera del bloque transaccional: un valor nuevo no se puede
--        usar en la misma transacción que lo crea) ──────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'modelo_retiro_enum') THEN
    ALTER TYPE modelo_retiro_enum ADD VALUE IF NOT EXISTS 'SEMANAL';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tipo_wallet_tx') THEN
    ALTER TYPE tipo_wallet_tx ADD VALUE IF NOT EXISTS 'PROPINA';
  END IF;
END $$;

BEGIN;

-- ─── 1. Trigger único: comisión gobernada por configuración ────────────────

CREATE OR REPLACE FUNCTION calc_booking_split()
RETURNS TRIGGER AS $$
DECLARE
  comm_rate NUMERIC;
BEGIN
  -- La comisión se lee de platform_config en cada alta/cambio de valor.
  -- Si la fila no existe o el valor es absurdo (fuera de 0–50%), se usa 20:
  -- una configuración corrupta no puede vaciar el pago del prestador.
  SELECT COALESCE(NULLIF(value, '')::NUMERIC, 20)
    INTO comm_rate
    FROM platform_config
   WHERE key = 'comision_plataforma_pct';

  IF comm_rate IS NULL OR comm_rate < 0 OR comm_rate > 50 THEN
    comm_rate := 20;
  END IF;

  NEW.comision_plataforma   := ROUND(NEW.valor_bruto * (comm_rate / 100.0), 2);
  NEW.impuestos_estado      := 0;
  NEW.pago_neto_prestador   := NEW.valor_bruto - NEW.comision_plataforma;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Reafirmar el trigger sobre bookings (por si la tabla se recreó sin él).
DROP TRIGGER IF EXISTS before_booking_insert_update ON bookings;
CREATE TRIGGER before_booking_insert_update
BEFORE INSERT OR UPDATE OF valor_bruto ON bookings
FOR EACH ROW EXECUTE FUNCTION calc_booking_split();

-- ─── 2. Configuración del ciclo del dinero ──────────────────────────────────

INSERT INTO platform_config (key, value, descripcion)
VALUES
  ('comision_plataforma_pct',       '20',     'Comisión única de servicios, todo incluido'),
  ('wallet_ventana_pendiente_horas','48',     'Horas de maduración post-servicio antes de poder retirar'),
  ('retiro_demanda_min_cop',        '100000', 'Monto mínimo del retiro anticipado en COP'),
  ('retiro_demanda_dias',           '7',      'Días del ciclo estándar de retiro'),
  ('retiro_costo_fijo_cop',         '1849',   'Costo fijo de dispersión Wompi que asume el prestador en retiro anticipado'),
  ('retiro_costo_pct',              '0.4',    'Porcentaje de dispersión Wompi que asume el prestador en retiro anticipado'),
  ('disputa_ventana_horas',         '48',     'Ventana para abrir disputa después de completado el servicio'),
  ('disputa_sla_dias',              '5',      'Días para resolver una disputa')
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      descripcion = EXCLUDED.descripcion,
      updated_at = NOW();

-- ─── 3. Tipo de origen del retiro: SEMANAL es el ciclo estándar ─────────────

ALTER TABLE retiros DROP CONSTRAINT IF EXISTS retiros_tipo_origen_check;
ALTER TABLE retiros
  ADD CONSTRAINT retiros_tipo_origen_check
  CHECK (tipo_origen IN ('DEMANDA','SEMANAL','QUINCENA','MENSUAL'));

COMMIT;

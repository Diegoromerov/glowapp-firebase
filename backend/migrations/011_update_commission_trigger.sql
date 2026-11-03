-- Migración 011: Actualización de Trigger para Comisión Continua de Servicios
-- Reemplaza la comisión plana del 12% por la fórmula de la curva continua.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS tarifa_reserva NUMERIC(10,2) DEFAULT 0.00;

CREATE OR REPLACE FUNCTION calc_booking_split()
RETURNS TRIGGER AS $$
DECLARE
  comm_rate NUMERIC;
BEGIN
  -- Fórmula continua: Comisión % = max(15%, 28% - 0.00008 * valor_bruto)
  comm_rate := 28.0 - (0.00008 * NEW.valor_bruto);
  IF comm_rate < 15.0 THEN
    comm_rate := 15.0;
  END IF;

  -- Calcular comisiones y retenciones
  NEW.comision_plataforma := ROUND(NEW.valor_bruto * (comm_rate / 100.0), 2);
  NEW.impuestos_estado := ROUND(NEW.valor_bruto * 0.08, 2);
  NEW.pago_neto_prestador := NEW.valor_bruto - (NEW.comision_plataforma + NEW.impuestos_estado);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Fix: SLA trigger para disputas y verificación final
CREATE OR REPLACE FUNCTION set_disputa_sla()
RETURNS TRIGGER AS $$
BEGIN
  NEW.sla_limite_at = NEW.creado_at + INTERVAL '48 hours';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_disputa_sla ON disputas;
CREATE TRIGGER trg_disputa_sla
  BEFORE INSERT ON disputas
  FOR EACH ROW EXECUTE FUNCTION set_disputa_sla();

DROP TRIGGER IF EXISTS trg_disputa_updated_at ON disputas;
CREATE TRIGGER trg_disputa_updated_at
  BEFORE UPDATE ON disputas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Verificar tablas creadas
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('provider_wallet','wallet_transactions','otp_validaciones','retiros','disputas','audit_log','platform_config')
ORDER BY table_name;

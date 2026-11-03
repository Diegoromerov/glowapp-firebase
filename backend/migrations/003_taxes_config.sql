-- ============================================================
-- MIGRACIÓN 003: Configuración de Retenciones Tributarias
-- ============================================================

INSERT INTO platform_config (key, value, descripcion) VALUES
  ('retefuente_pct', '4.0', 'Porcentaje de retención en la fuente sobre servicios estéticos (4%)'),
  ('reteiva_pct', '15.0', 'Porcentaje de retención de IVA sobre la comisión financiera (15%)'),
  ('reteica_pct', '0.414', 'Porcentaje de retención de ICA para Bogotá (4.14 x 1000 = 0.414%)')
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  descripcion = EXCLUDED.descripcion;

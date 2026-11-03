-- 102_create_biometric_scan_comparisons.sql
-- Y-F3: cada escaneo se compara con el anterior del mismo usuario y el resultado
-- queda guardado (no se recalcula cada vez que se pide).
--
-- El detalle por métrica se guarda cifrado (ADR-001: derivados biométricos). En claro
-- quedan solo el veredicto y los contadores, que permiten auditar cobertura sin
-- descifrar: cuántas métricas se compararon y cuántas cruzaron el umbral.
--
-- `threshold` se guarda con la fila: si mañana cambia el umbral, la comparación vieja
-- sigue diciendo con qué criterio se juzgó.

CREATE TABLE IF NOT EXISTS biometric_scan_comparisons (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  baseline_scan_id BIGINT NOT NULL,
  current_scan_id BIGINT NOT NULL,
  threshold NUMERIC(5, 2) NOT NULL,
  verdict VARCHAR(24) NOT NULL,
  compared_count INTEGER NOT NULL DEFAULT 0,
  significant_count INTEGER NOT NULL DEFAULT 0,
  metrics_encrypted TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT biometric_scan_comparisons_current_unique UNIQUE (current_scan_id),
  CONSTRAINT biometric_scan_comparisons_distinct_scans CHECK (baseline_scan_id <> current_scan_id)
);

CREATE INDEX IF NOT EXISTS idx_biometric_scan_comparisons_user_created
  ON biometric_scan_comparisons (user_id, created_at DESC);

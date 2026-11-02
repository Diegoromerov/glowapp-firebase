-- 100_create_biometric_scan_sessions.sql
-- Y-F1: persiste la llamada completa a YouCam (16 acciones HD, raw_score, máscaras).
--
-- Por qué una tabla nueva y no columnas en beauty_profiles:
--   * beauty_profiles guarda el último perfil (upsert), no la serie temporal.
--   * biometric_history guarda el perfil cifrado que exige consentimiento, pero sin
--     estructura por subregión ni identificador de tarea del proveedor.
--
-- Cifrado: ADR-001 exige cifrar los datos biométricos en reposo. Los scores derivados
-- de una foto son datos biométricos, así que el bloque completo de métricas se guarda
-- como ciphertext AES-256-GCM (biometricCryptoService) en `metrics_encrypted`.
-- Lo único en claro son contadores y metadatos no identificatorios (acciones pedidas,
-- acciones ausentes, número de métricas), que sirven para auditar la llamada sin
-- descifrar nada.
--
-- user_id sin FOREIGN KEY a propósito: `usuarios.id` cambió de tipo en la 029 y esta
-- tabla no debe arrastrar ese acoplamiento; la integridad se valida en el servicio.

CREATE TABLE IF NOT EXISTS biometric_scan_sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  provider VARCHAR(32) NOT NULL DEFAULT 'youcam',
  provider_task_id TEXT,
  metrics_encrypted TEXT NOT NULL,
  metrics_count INTEGER NOT NULL,
  requested_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  missing_metrics JSONB NOT NULL DEFAULT '[]'::jsonb,
  geometry JSONB,
  quality JSONB,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_biometric_scan_sessions_user_captured
  ON biometric_scan_sessions (user_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_biometric_scan_sessions_task
  ON biometric_scan_sessions (provider_task_id);

-- 104_add_image_fingerprint_to_scan_sessions.sql
-- Y-F5: permite reutilizar el análisis ya pagado de una foto idéntica.
--
-- Qué se guarda y dónde, y por qué esa separación:
--
--   * image_hash -> HMAC-SHA256 del JPEG normalizado, con pepper del servidor.
--     Va en claro porque hay que buscar por índice, pero NO es un sha256 pelado:
--     sin el pepper nadie puede comprobar si una foto concreta pertenece a un usuario.
--
--   * dHash (descriptor de la foto) -> NO va aquí. Es un dato biométrico derivado y
--     ADR-001 exige cifrarlo en reposo, así que viaja dentro del payload cifrado de la
--     sesión (`metrics_encrypted`, AES-256-GCM) y se compara descifrando las últimas
--     sesiones del usuario.
--
-- La búsqueda filtra SIEMPRE por user_id: la misma foto de otra persona nunca
-- reutiliza métricas ajenas.

ALTER TABLE biometric_scan_sessions ADD COLUMN IF NOT EXISTS image_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_biometric_scan_sessions_user_hash
  ON biometric_scan_sessions (user_id, image_hash);

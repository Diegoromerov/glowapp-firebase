-- 106_biometric_retention.sql
--
-- T-111 — Plazo de conservación de los datos biométricos.
--
-- Dos cambios, ambos para que el plazo prometido en el aviso 2.2 se pueda cumplir:
--
-- 1. `biometric_access_log.user_id` deja de ser NOT NULL. Hasta ahora el log exigía un
--    usuario, de modo que la purga por retención —que borra escaneos de muchas personas
--    a la vez— no podía dejar constancia de lo que hizo sin volver a guardar
--    identificadores de gente cuyos datos acaba de suprimir. La fila de purga queda con
--    `user_id = NULL`, `accessed_by = 'system_retention'` y conteos agregados.
--
-- 2. Índice sobre `captured_at`. El índice existente es (user_id, captured_at) y no
--    sirve para «todo lo anterior a esta fecha»: sin éste, cada purga recorre la tabla
--    completa.

ALTER TABLE biometric_access_log ALTER COLUMN user_id DROP NOT NULL;

COMMENT ON COLUMN biometric_access_log.user_id IS
  'NULL = evento del sistema (purga por retención), sin dato personal asociado';

CREATE INDEX IF NOT EXISTS idx_biometric_scan_sessions_captured_at
  ON biometric_scan_sessions (captured_at);

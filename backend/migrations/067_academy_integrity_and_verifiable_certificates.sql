-- migrations/067_academy_integrity_and_verifiable_certificates.sql
-- ============================================================================
-- Integridad de la Academia Glow (auditoría 2026-09-22, hallazgos B3/B9/B14):
--   · academia_quiz_attempts  → límite y trazabilidad de intentos del examen
--     (antes: intentos ilimitados, sin registro; el certificado se podía forzar)
--   · academy_certificates    → código público verificable + estado de revocación
--     (antes: fila sin identificador externo, imposible de verificar o revocar)
--   · academy_courses         → soft-delete (antes: DELETE borraba en cascada el
--     progreso y los certificados de las alumnas)
--   · academy_consentimientos → prueba del consentimiento (versión, hash, IP, UA)
--
-- Idempotente: se puede re-ejecutar en cada arranque.
-- ============================================================================

-- 1) Intentos del examen -----------------------------------------------------
CREATE TABLE IF NOT EXISTS academy_quiz_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES academy_courses(id) ON DELETE CASCADE,
    score INT NOT NULL DEFAULT 0,
    total INT NOT NULL DEFAULT 0,
    correct_pct NUMERIC(5, 2) NOT NULL DEFAULT 0,
    pass_pct INT NOT NULL DEFAULT 80,
    passed BOOLEAN NOT NULL DEFAULT FALSE,
    answers JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_academy_quiz_attempts_provider_course
    ON academy_quiz_attempts (provider_id, course_id, created_at DESC);

-- 2) Certificado verificable -------------------------------------------------
ALTER TABLE academy_certificates ADD COLUMN IF NOT EXISTS code VARCHAR(32);
ALTER TABLE academy_certificates ADD COLUMN IF NOT EXISTS revoked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE academy_certificates ADD COLUMN IF NOT EXISTS revoked_reason TEXT;
ALTER TABLE academy_certificates ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE academy_certificates ADD COLUMN IF NOT EXISTS curriculum_version VARCHAR(20) DEFAULT 'v1';

-- Backfill para certificados emitidos antes de este cambio (id es PK desde 033)
UPDATE academy_certificates
   SET code = 'GLW-' || upper(substr(replace(id::text, '-', ''), 1, 12))
 WHERE code IS NULL;

ALTER TABLE academy_certificates ALTER COLUMN code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_academy_certificates_code
    ON academy_certificates (upper(code));

-- 3) Soft-delete de cursos ---------------------------------------------------
ALTER TABLE academy_courses ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 4) Prueba del consentimiento (Ley 1581: finalidad + trazabilidad) ----------
ALTER TABLE academy_consentimientos ADD COLUMN IF NOT EXISTS texto_version VARCHAR(20);
ALTER TABLE academy_consentimientos ADD COLUMN IF NOT EXISTS texto_hash CHAR(64);
ALTER TABLE academy_consentimientos ADD COLUMN IF NOT EXISTS aceptado_ip VARCHAR(45);
ALTER TABLE academy_consentimientos ADD COLUMN IF NOT EXISTS aceptado_user_agent VARCHAR(255);

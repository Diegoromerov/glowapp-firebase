-- Migration 034: Añade FKs a badges(id) y academy_certificates(id) después de que migración 033 cree la columna id en academy_certificates
-- Estas FKs referencian la nueva PK surrogate 'id' de academy_certificates y badges

DO $$
BEGIN
    -- La migración 033 añadió la columna surrogate id a academy_certificates,
    -- pero sin restricción de unicidad, y PostgreSQL no permite referenciar una
    -- columna que no sea única («there is no unique constraint matching given
    -- keys for referenced table "academy_certificates"»). Se garantiza de forma
    -- idempotente antes de crear las FKs que dependen de ella.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'academy_certificates' AND c.contype IN ('p', 'u')
          AND pg_get_constraintdef(c.oid) LIKE '%(id)%'
    ) THEN
        ALTER TABLE academy_certificates ADD CONSTRAINT academy_certificates_id_key UNIQUE (id);
    END IF;

    -- FK en learning_paths.badge_id -> badges(id)
    IF to_regclass('learning_paths') IS NOT NULL
       AND to_regclass('badges') IS NOT NULL
       AND NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE table_name='learning_paths' AND constraint_name='fk_learning_paths_badge_id'
    ) THEN
        ALTER TABLE learning_paths 
        ADD CONSTRAINT fk_learning_paths_badge_id 
        FOREIGN KEY (badge_id) REFERENCES badges(id);
    END IF;

    -- FK en user_levels.badge_id -> badges(id)
    IF to_regclass('user_levels') IS NOT NULL
       AND to_regclass('badges') IS NOT NULL
       AND NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE table_name='user_levels' AND constraint_name='fk_user_levels_badge_id'
    ) THEN
        ALTER TABLE user_levels 
        ADD CONSTRAINT fk_user_levels_badge_id 
        FOREIGN KEY (badge_id) REFERENCES badges(id);
    END IF;

    -- FK en qr_certificates.certificate_id -> academy_certificates(id)
    IF to_regclass('qr_certificates') IS NOT NULL
       AND to_regclass('academy_certificates') IS NOT NULL
       AND NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE table_name='qr_certificates' AND constraint_name='fk_qr_certificates_certificate_id'
    ) THEN
        ALTER TABLE qr_certificates 
        ADD CONSTRAINT fk_qr_certificates_certificate_id 
        FOREIGN KEY (certificate_id) REFERENCES academy_certificates(id);
    END IF;
END $$;
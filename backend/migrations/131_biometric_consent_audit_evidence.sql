-- 131: evidencias de autorización biométrica y bitácora append-only.
-- Ley 1581/2012 arts. 6, 8, 9, 12, 15 y Decreto 1074/2015.
-- La evidencia conserva solo los campos necesarios para demostrar qué se aceptó
-- y cuándo. No tiene FK al usuario para que la prueba de revocación/supresión no
-- desaparezca por cascada al cerrar una cuenta.

BEGIN;

ALTER TABLE biometric_consents
  ADD COLUMN IF NOT EXISTS explicit_authorization BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS document_sha256 CHAR(64),
  ADD COLUMN IF NOT EXISTS terms_snapshot JSONB;

COMMENT ON COLUMN biometric_consents.explicit_authorization IS
  'TRUE solo cuando el titular confirmó voluntariamente la autorización expresa; consentimientos previos sin prueba quedan FALSE.';
COMMENT ON COLUMN biometric_consents.document_sha256 IS
  'SHA-256 del snapshot JSON canónico servido y aceptado por el titular.';
COMMENT ON COLUMN biometric_consents.terms_snapshot IS
  'Snapshot de la versión informativa aceptada, para reconstruir la prueba aun después de publicar una versión nueva.';

CREATE TABLE IF NOT EXISTS biometric_consent_audit (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  consent_id TEXT NOT NULL,
  event_type VARCHAR(32) NOT NULL CHECK (event_type IN ('GRANTED', 'REVOKED', 'AMENDED', 'CONSENT_RECORD_DELETED', 'SUPPRESSION_REQUESTED', 'SUPPRESSION_COMPLETED', 'SUPPRESSION_FAILED')),
  request_id UUID,
  consent_type VARCHAR(50) NOT NULL,
  granted BOOLEAN NOT NULL,
  granted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  purpose TEXT,
  version_terms VARCHAR(20),
  explicit_authorization BOOLEAN NOT NULL DEFAULT FALSE,
  document_sha256 CHAR(64),
  terms_snapshot JSONB,
  happened_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  state_before JSONB,
  state_after JSONB
);

CREATE INDEX IF NOT EXISTS idx_biometric_consent_audit_time
  ON biometric_consent_audit (happened_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_biometric_consent_audit_subject
  ON biometric_consent_audit (user_id, happened_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_biometric_consent_audit_action
  ON biometric_consent_audit (event_type, happened_at DESC);
CREATE INDEX IF NOT EXISTS idx_biometric_consent_audit_request
  ON biometric_consent_audit (request_id, happened_at DESC) WHERE request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION append_biometric_consent_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_before JSONB;
  v_after JSONB;
  v_event VARCHAR(32);
  v_row RECORD;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_row := NEW;
    v_after := jsonb_build_object(
      'granted', NEW.granted, 'granted_at', NEW.granted_at,
      'revoked_at', NEW.revoked_at, 'purpose', NEW.purpose,
      'version_terms', NEW.version_terms,
      'explicit_authorization', NEW.explicit_authorization,
      'document_sha256', NEW.document_sha256,
      'terms_snapshot', NEW.terms_snapshot
    );
    v_event := CASE WHEN NEW.granted THEN 'GRANTED' ELSE 'AMENDED' END;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.granted IS NOT DISTINCT FROM NEW.granted
       AND OLD.revoked_at IS NOT DISTINCT FROM NEW.revoked_at
       AND OLD.purpose IS NOT DISTINCT FROM NEW.purpose
       AND OLD.version_terms IS NOT DISTINCT FROM NEW.version_terms
       AND OLD.explicit_authorization IS NOT DISTINCT FROM NEW.explicit_authorization
       AND OLD.document_sha256 IS NOT DISTINCT FROM NEW.document_sha256
       AND OLD.terms_snapshot IS NOT DISTINCT FROM NEW.terms_snapshot THEN
      RETURN NEW;
    END IF;
    v_row := NEW;
    v_before := jsonb_build_object(
      'granted', OLD.granted, 'granted_at', OLD.granted_at,
      'revoked_at', OLD.revoked_at, 'purpose', OLD.purpose,
      'version_terms', OLD.version_terms,
      'explicit_authorization', OLD.explicit_authorization,
      'document_sha256', OLD.document_sha256,
      'terms_snapshot', OLD.terms_snapshot
    );
    v_after := jsonb_build_object(
      'granted', NEW.granted, 'granted_at', NEW.granted_at,
      'revoked_at', NEW.revoked_at, 'purpose', NEW.purpose,
      'version_terms', NEW.version_terms,
      'explicit_authorization', NEW.explicit_authorization,
      'document_sha256', NEW.document_sha256,
      'terms_snapshot', NEW.terms_snapshot
    );
    v_event := CASE
      WHEN NEW.granted AND (NOT OLD.granted OR OLD.revoked_at IS NOT NULL) THEN 'GRANTED'
      WHEN NOT NEW.granted OR NEW.revoked_at IS NOT NULL THEN 'REVOKED'
      ELSE 'AMENDED'
    END;
  ELSE
    v_row := OLD;
    v_before := jsonb_build_object(
      'granted', OLD.granted, 'granted_at', OLD.granted_at,
      'revoked_at', OLD.revoked_at, 'purpose', OLD.purpose,
      'version_terms', OLD.version_terms,
      'explicit_authorization', OLD.explicit_authorization,
      'document_sha256', OLD.document_sha256,
      'terms_snapshot', OLD.terms_snapshot
    );
    v_event := 'CONSENT_RECORD_DELETED';
  END IF;

  INSERT INTO biometric_consent_audit (
    user_id, consent_id, event_type, consent_type, granted, granted_at,
    revoked_at, purpose, version_terms, explicit_authorization,
    document_sha256, terms_snapshot, state_before, state_after
  ) VALUES (
    v_row.user_id, v_row.id::TEXT, v_event, v_row.consent_type,
    COALESCE(v_row.granted, FALSE), v_row.granted_at, v_row.revoked_at,
    v_row.purpose, v_row.version_terms,
    COALESCE(v_row.explicit_authorization, FALSE), v_row.document_sha256,
    v_row.terms_snapshot, v_before, v_after
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_biometric_consent_audit ON biometric_consents;
CREATE TRIGGER trg_biometric_consent_audit
  AFTER INSERT OR UPDATE OR DELETE ON biometric_consents
  FOR EACH ROW EXECUTE FUNCTION append_biometric_consent_audit();

CREATE OR REPLACE FUNCTION prevent_biometric_consent_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'biometric_consent_audit is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_biometric_consent_audit_immutable ON biometric_consent_audit;
CREATE TRIGGER trg_biometric_consent_audit_immutable
  BEFORE UPDATE OR DELETE ON biometric_consent_audit
  FOR EACH ROW EXECUTE FUNCTION prevent_biometric_consent_audit_mutation();

COMMENT ON TABLE biometric_consent_audit IS
  'Bitácora append-only de prueba de consentimiento sensible, revocación, cambios y supresión del registro; acceso únicamente mediante API administrativa autorizada.';

COMMIT;

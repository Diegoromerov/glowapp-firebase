-- 134: bitácora de ciclo de vida, validación de identidad y supresión ARCO.
BEGIN;

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS identity_verified_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS identity_verified_by INTEGER;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS identity_verification_method VARCHAR(40);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS identity_verification_reference VARCHAR(100);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS workflow_actor_id INTEGER;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS suppression_executed_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS suppression_manifest JSONB;

CREATE TABLE IF NOT EXISTS ticket_workflow_audit (
  id BIGSERIAL PRIMARY KEY,
  ticket_id UUID NOT NULL,
  requester_id INTEGER NOT NULL,
  actor_id INTEGER,
  event_type VARCHAR(40) NOT NULL CHECK (event_type IN (
    'CREATED', 'STATE_CHANGED', 'IDENTITY_VERIFIED', 'SUPPRESSION_EXECUTED',
    'MESSAGE_ADDED', 'TICKET_DELETED'
  )),
  state_before VARCHAR(50),
  state_after VARCHAR(50),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  happened_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_ticket_workflow_audit_ticket
  ON ticket_workflow_audit (ticket_id, happened_at, id);
CREATE INDEX IF NOT EXISTS idx_ticket_workflow_audit_requester
  ON ticket_workflow_audit (requester_id, happened_at DESC);

CREATE OR REPLACE FUNCTION append_ticket_workflow_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_row RECORD;
  v_event VARCHAR(40);
  v_before VARCHAR(50);
  v_after VARCHAR(50);
  v_details JSONB := '{}'::jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
    v_event := 'TICKET_DELETED';
    v_before := OLD.estado;
  ELSIF TG_OP = 'INSERT' THEN
    v_row := NEW;
    v_event := 'CREATED';
    v_after := NEW.estado;
    v_details := jsonb_build_object('tipo', NEW.tipo, 'categoria', NEW.categoria);
  ELSE
    v_row := NEW;
    v_before := OLD.estado;
    v_after := NEW.estado;
    IF OLD.identity_verified_at IS DISTINCT FROM NEW.identity_verified_at
       AND NEW.identity_verified_at IS NOT NULL THEN
      v_event := 'IDENTITY_VERIFIED';
      v_details := jsonb_build_object(
        'method', NEW.identity_verification_method,
        'reference', NEW.identity_verification_reference
      );
    ELSIF OLD.suppression_executed_at IS DISTINCT FROM NEW.suppression_executed_at
       AND NEW.suppression_executed_at IS NOT NULL THEN
      v_event := 'SUPPRESSION_EXECUTED';
      v_details := COALESCE(NEW.suppression_manifest, '{}'::jsonb);
    ELSIF OLD.estado IS DISTINCT FROM NEW.estado THEN
      v_event := 'STATE_CHANGED';
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO ticket_workflow_audit
    (ticket_id, requester_id, actor_id, event_type, state_before, state_after, details)
  VALUES
    (v_row.id, v_row.usuario_id, CASE WHEN TG_OP = 'INSERT' THEN v_row.usuario_id
      WHEN TG_OP = 'UPDATE' THEN COALESCE(NEW.workflow_actor_id, NEW.identity_verified_by) ELSE NULL END,
     v_event, v_before, v_after, v_details);

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ticket_workflow_audit ON tickets;
CREATE TRIGGER trg_ticket_workflow_audit
  AFTER INSERT OR UPDATE OR DELETE ON tickets
  FOR EACH ROW EXECUTE FUNCTION append_ticket_workflow_audit();

CREATE OR REPLACE FUNCTION append_ticket_message_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_requester INTEGER;
BEGIN
  SELECT usuario_id INTO v_requester FROM tickets WHERE id = NEW.ticket_id;
  IF v_requester IS NOT NULL THEN
    INSERT INTO ticket_workflow_audit
      (ticket_id, requester_id, actor_id, event_type, details)
    VALUES
      (NEW.ticket_id, v_requester, NEW.remitente_id, 'MESSAGE_ADDED',
       jsonb_build_object('autor_tipo', COALESCE(NEW.autor_tipo, 'USUARIO'), 'es_borrador', COALESCE(NEW.es_borrador, FALSE)));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ticket_message_audit ON ticket_mensajes;
CREATE TRIGGER trg_ticket_message_audit
  AFTER INSERT ON ticket_mensajes
  FOR EACH ROW EXECUTE FUNCTION append_ticket_message_audit();

CREATE OR REPLACE FUNCTION prevent_ticket_workflow_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'ticket_workflow_audit is append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_ticket_workflow_audit_immutable ON ticket_workflow_audit;
CREATE TRIGGER trg_ticket_workflow_audit_immutable
  BEFORE UPDATE OR DELETE ON ticket_workflow_audit
  FOR EACH ROW EXECUTE FUNCTION prevent_ticket_workflow_audit_mutation();

CREATE OR REPLACE FUNCTION prevent_arco_evidence_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.suppression_executed_at IS NOT NULL AND (
      OLD.suppression_executed_at IS DISTINCT FROM NEW.suppression_executed_at OR
      OLD.suppression_manifest IS DISTINCT FROM NEW.suppression_manifest OR
      OLD.identity_verified_at IS DISTINCT FROM NEW.identity_verified_at OR
      OLD.identity_verified_by IS DISTINCT FROM NEW.identity_verified_by OR
      OLD.identity_verification_method IS DISTINCT FROM NEW.identity_verification_method OR
      OLD.identity_verification_reference IS DISTINCT FROM NEW.identity_verification_reference
    ) THEN
    RAISE EXCEPTION 'completed ARCO evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_arco_evidence_immutable ON tickets;
CREATE TRIGGER trg_arco_evidence_immutable
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION prevent_arco_evidence_mutation();

CREATE OR REPLACE FUNCTION prevent_completed_arco_deletion()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.tipo = 'ARCO_SUPRESION' AND OLD.suppression_executed_at IS NOT NULL THEN
    RAISE EXCEPTION 'completed ARCO case record is retained for audit';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_completed_arco_retained ON tickets;
CREATE TRIGGER trg_completed_arco_retained
  BEFORE DELETE ON tickets
  FOR EACH ROW EXECUTE FUNCTION prevent_completed_arco_deletion();

COMMENT ON TABLE ticket_workflow_audit IS
  'Bitácora append-only de radicación, cambios de estado, verificación de identidad, mensajes y ejecución ARCO. No almacena el texto de mensajes.';

COMMIT;

BEGIN;

-- Enforce one open service dispute per booking even under concurrent requests.
-- The application serializes opening by locking the booking row. We deliberately
-- do not add a unique index here because historic duplicate active cases must be
-- reviewed before a constraint can be safely deployed.
ALTER TABLE public.disputas
  ADD COLUMN IF NOT EXISTS reembolso_estado VARCHAR(20),
  ADD COLUMN IF NOT EXISTS reembolso_monto NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS reembolso_actualizado_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reembolso_wompi_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS reembolso_transaction_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS reembolso_referencia VARCHAR(100),
  ADD COLUMN IF NOT EXISTS workflow_actor_id INTEGER REFERENCES public.usuarios(id) ON DELETE SET NULL;

ALTER TABLE public.disputa_mensajes
  ADD COLUMN IF NOT EXISTS evidencia_urls TEXT[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'disputas_reembolso_estado_check') THEN
    ALTER TABLE public.disputas ADD CONSTRAINT disputas_reembolso_estado_check
      CHECK (reembolso_estado IS NULL OR reembolso_estado IN ('NO_APLICA', 'PENDIENTE', 'PROCESANDO', 'COMPLETADO', 'FALLIDO'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.disputa_workflow_audit (
  id BIGSERIAL PRIMARY KEY,
  disputa_id UUID NOT NULL REFERENCES public.disputas(id) ON DELETE RESTRICT,
  actor_id INTEGER REFERENCES public.usuarios(id) ON DELETE SET NULL,
  evento VARCHAR(40) NOT NULL CHECK (evento IN (
    'CREADA', 'ESTADO_CAMBIADO', 'RESUELTA', 'EVIDENCIA_AGREGADA', 'REEMBOLSO_ACTUALIZADO'
  )),
  estado_anterior VARCHAR(30),
  estado_nuevo VARCHAR(30),
  detalles JSONB NOT NULL DEFAULT '{}'::jsonb,
  creado_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_disputa_workflow_audit_caso
  ON public.disputa_workflow_audit (disputa_id, creado_at, id);

CREATE OR REPLACE FUNCTION append_disputa_workflow_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_evento VARCHAR(40);
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_evento := 'CREADA';
    INSERT INTO public.disputa_workflow_audit
      (disputa_id, actor_id, evento, estado_nuevo, detalles)
    VALUES (NEW.id, NEW.iniciado_por, v_evento, NEW.estado::text,
      jsonb_build_object('booking_id', NEW.booking_id, 'tipo', NEW.tipo::text));
    RETURN NEW;
  END IF;

  IF OLD.estado IS DISTINCT FROM NEW.estado THEN
    v_evento := CASE WHEN NEW.estado::text = 'RESUELTA' THEN 'RESUELTA' ELSE 'ESTADO_CAMBIADO' END;
    INSERT INTO public.disputa_workflow_audit
      (disputa_id, actor_id, evento, estado_anterior, estado_nuevo, detalles)
    VALUES (NEW.id, COALESCE(NEW.resuelto_por, NEW.workflow_actor_id), v_evento,
      OLD.estado::text, NEW.estado::text,
      jsonb_build_object('resolucion', NEW.resolucion::text,
        'porcentaje_prestador', NEW.porcentaje_prestador,
        'nota_resolucion', NEW.nota_resolucion,
        'reembolso_estado', NEW.reembolso_estado,
        'reembolso_monto', NEW.reembolso_monto,
        'reembolso_wompi_id', NEW.reembolso_wompi_id));
  END IF;

  IF OLD.reembolso_estado IS DISTINCT FROM NEW.reembolso_estado THEN
    v_evento := 'REEMBOLSO_ACTUALIZADO';
    INSERT INTO public.disputa_workflow_audit
      (disputa_id, actor_id, evento, estado_anterior, estado_nuevo, detalles)
    VALUES (NEW.id, COALESCE(NEW.resuelto_por, NEW.workflow_actor_id), v_evento,
      OLD.reembolso_estado, NEW.reembolso_estado,
      jsonb_build_object('monto', NEW.reembolso_monto, 'wompi_id', NEW.reembolso_wompi_id));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_disputa_workflow_audit ON public.disputas;
CREATE TRIGGER trg_disputa_workflow_audit
  AFTER INSERT OR UPDATE OF estado, reembolso_estado ON public.disputas
  FOR EACH ROW EXECUTE FUNCTION append_disputa_workflow_audit();

CREATE OR REPLACE FUNCTION append_disputa_evidence_audit()
RETURNS TRIGGER AS $$
BEGIN
  IF cardinality(COALESCE(NEW.evidencia_urls, '{}'::text[])) > 0 THEN
    INSERT INTO public.disputa_workflow_audit
      (disputa_id, actor_id, evento, detalles)
    VALUES (NEW.disputa_id, NEW.remitente_id, 'EVIDENCIA_AGREGADA',
      jsonb_build_object('mensaje_id', NEW.id, 'audiencia', NEW.audiencia,
        'cantidad', cardinality(NEW.evidencia_urls)));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_disputa_evidence_audit ON public.disputa_mensajes;
CREATE TRIGGER trg_disputa_evidence_audit
  AFTER INSERT ON public.disputa_mensajes
  FOR EACH ROW EXECUTE FUNCTION append_disputa_evidence_audit();

CREATE OR REPLACE FUNCTION prevent_disputa_workflow_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'disputa_workflow_audit is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_disputa_workflow_audit_immutable ON public.disputa_workflow_audit;
CREATE TRIGGER trg_disputa_workflow_audit_immutable
  BEFORE UPDATE OR DELETE ON public.disputa_workflow_audit
  FOR EACH ROW EXECUTE FUNCTION prevent_disputa_workflow_audit_mutation();

ALTER TABLE public.disputa_workflow_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disputa_workflow_audit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS disputa_workflow_audit_system ON public.disputa_workflow_audit;
CREATE POLICY disputa_workflow_audit_system ON public.disputa_workflow_audit
  FOR ALL TO app_system USING (true) WITH CHECK (true);
REVOKE ALL ON public.disputa_workflow_audit FROM PUBLIC, app_rls_user;
GRANT SELECT, INSERT ON public.disputa_workflow_audit TO app_system;
GRANT USAGE, SELECT ON SEQUENCE public.disputa_workflow_audit_id_seq TO app_system;

COMMIT;

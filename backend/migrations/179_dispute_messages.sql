-- Historial de respuestas y notas para la bandeja administrativa de disputas.
CREATE TABLE IF NOT EXISTS public.disputa_mensajes (
  id BIGSERIAL PRIMARY KEY,
  disputa_id UUID NOT NULL REFERENCES public.disputas(id) ON DELETE CASCADE,
  remitente_id INTEGER REFERENCES public.usuarios(id) ON DELETE SET NULL,
  audiencia VARCHAR(12) NOT NULL CHECK (audiencia IN ('PARTES', 'INTERNA')),
  mensaje TEXT NOT NULL CHECK (length(btrim(mensaje)) BETWEEN 1 AND 4000),
  tenant_id INTEGER NOT NULL,
  creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disputa_mensajes_hilo
  ON public.disputa_mensajes (disputa_id, creado_at, id);
CREATE INDEX IF NOT EXISTS idx_disputa_mensajes_tenant
  ON public.disputa_mensajes (tenant_id, creado_at DESC);

ALTER TABLE public.disputa_mensajes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disputa_mensajes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS disputa_mensajes_tenant ON public.disputa_mensajes;
-- El rol de aplicación solo puede leer respuestas compartidas. Las notas
-- internas y todas las escrituras se gestionan mediante endpoints app_system.
CREATE POLICY disputa_mensajes_tenant ON public.disputa_mensajes
  FOR SELECT TO app_rls_user
  USING (tenant_id = public.app_current_tenant_id() AND audiencia = 'PARTES');
DROP POLICY IF EXISTS disputa_mensajes_system ON public.disputa_mensajes;
CREATE POLICY disputa_mensajes_system ON public.disputa_mensajes
  FOR ALL TO app_system USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.disputa_mensajes TO app_rls_user, app_system;
GRANT USAGE, SELECT ON SEQUENCE public.disputa_mensajes_id_seq TO app_rls_user, app_system;

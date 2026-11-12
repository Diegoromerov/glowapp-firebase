-- 149_ai_usage_events.sql
--
-- Hoy nadie sabe cuánto cuesta una usuaria: ni DeepSeek ni YouCam registran su
-- consumo. Con el paquete de YouCam a 500 puntos por $80.000 COP, cada lectura
-- HD son $1.920 COP y no hay una sola fila que diga cuántas se hicieron.
--
-- Una fila por llamada a un proveedor de IA, con lo que el proveedor cobró y lo
-- que eso vale en pesos. Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            INTEGER,
  tenant_id          INTEGER,
  proveedor          TEXT NOT NULL,          -- deepseek | gemini | youcam | nvidia
  modelo             TEXT,
  tipo_uso           TEXT NOT NULL DEFAULT 'analisis', -- analisis | recomendacion | vto | diagnostico
  lectura_tipo       TEXT,                   -- SD | HD (sólo YouCam)
  puntos_consumidos  INTEGER,                -- unidades del proveedor, si informa
  tokens_entrada     INTEGER,
  tokens_salida      INTEGER,
  costo_cop          NUMERIC(12,2),          -- calculado de la tarifa vigente
  trace_id           TEXT,
  clave              TEXT UNIQUE,            -- idempotencia: un hecho, una fila
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_user_mes
  ON ai_usage_events (user_id, creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_ai_usage_por_proveedor
  ON ai_usage_events (proveedor, creado_en DESC);

-- Aislamiento por inquilino, igual que las otras 44 tablas de negocio: la
-- cadena de migraciones rechaza cualquier tabla con `tenant_id` sin FORCE ni
-- política, y con razón.
ALTER TABLE ai_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON ai_usage_events;
CREATE POLICY tenant_isolation ON ai_usage_events
  USING (tenant_id IS NOT NULL AND tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = app_current_tenant_id());

COMMENT ON TABLE ai_usage_events IS
  'Consumo real de proveedores de IA por llamada. Base de las cuotas de nivel (E5).';

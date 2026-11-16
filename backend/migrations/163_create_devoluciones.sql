-- 163_create_devoluciones.sql
-- Migración F1-Logística: Tabla de devoluciones (logística inversa)

CREATE TABLE IF NOT EXISTS devoluciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id UUID NOT NULL REFERENCES pedidos_tienda(id) ON DELETE RESTRICT,
  envio_original_id UUID REFERENCES envios(id) ON DELETE SET NULL,
  envio_retorno_id UUID REFERENCES envios(id) ON DELETE SET NULL,
  
  -- Quién inicia y quién recibe
  solicitante_id INTEGER NOT NULL REFERENCES usuarios(id),        -- Cliente que solicita
  receptor_id INTEGER REFERENCES usuarios(id),                    -- Proveedor/salón que recibe
  
  -- Motivo y detalle
  motivo VARCHAR(50) NOT NULL CHECK (motivo IN (
    'defectuoso', 'no_gusta', 'talla_incorrecta', 'producto_incorrecto',
    'dañado_envio', 'llegó_tarde', 'cambio_opinion', 'otro'
  )),
  descripcion TEXT,
  fotos_urls TEXT[],                      -- Array de URLs a evidencia (Storage)
  
  -- Estado del proceso
  estado VARCHAR(30) NOT NULL DEFAULT 'SOLICITADA' CHECK (estado IN (
    'SOLICITADA',           -- Cliente pidió devolución
    'ETIQUETA_GENERADA',    -- Plataforma generó etiqueta retorno (Envíame)
    'ENVIADA',              -- Cliente entregó a carrier
    'EN_TRANSITO_RETORNO',  -- Carrier tiene el paquete
    'RECIBIDA_PROVEEDOR',   -- Proveedor/salón recibió físicamente
    'INSPECCIONADA',        -- Proveedor revisó el producto
    'APROBADA',             -- Aceptada: procede reembolso/cambio
    'RECHAZADA',            -- No cumple condiciones (usado, sin etiquetas, etc.)
    'REEMBOLSADA',          -- Dinero devuelto al cliente
    'CAMBIADA',             -- Se envió producto distinto
    'CERRADA'               -- Proceso finalizado sin reembolso (rechazada o cliente no envió)
  )),
  
  -- Resolución
  tipo_resolucion VARCHAR(30) CHECK (tipo_resolucion IN (
    'reembolso_total', 'reembolso_parcial', 'cambio_producto', 'nota_credito', 'sin_resolucion'
  )),
  monto_reembolso NUMERIC(10,2) DEFAULT 0,
  producto_cambio_id INTEGER REFERENCES productos(id),
  
  -- Trazabilidad
  etiqueta_retorno_pdf_url TEXT,
  etiqueta_retorno_zpl TEXT,
  carrier_retorno VARCHAR(50),
  guia_retorno VARCHAR(100),
  url_rastreo_retorno TEXT,
  
  -- Fechas clave
  solicitada_en TIMESTAMPTZ DEFAULT NOW(),
  etiqueta_generada_en TIMESTAMPTZ,
  enviada_en TIMESTAMPTZ,
  recibida_proveedor_en TIMESTAMPTZ,
  inspeccionada_en TIMESTAMPTZ,
  resuelta_en TIMESTAMPTZ,
  cerrada_en TIMESTAMPTZ,
  
  -- Auditoría
  observaciones_internas TEXT,
  resuelto_por INTEGER REFERENCES usuarios(id),
  
  tenant_id INTEGER NOT NULL REFERENCES tenants(id)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_devoluciones_pedido ON devoluciones(pedido_id);
CREATE INDEX IF NOT EXISTS idx_devoluciones_solicitante ON devoluciones(solicitante_id);
CREATE INDEX IF NOT EXISTS idx_devoluciones_receptor ON devoluciones(receptor_id);
CREATE INDEX IF NOT EXISTS idx_devoluciones_estado ON devoluciones(estado) WHERE estado NOT IN ('CERRADA', 'REEMBOLSADA', 'CAMBIADA');
CREATE INDEX IF NOT EXISTS idx_devoluciones_tenant ON devoluciones(tenant_id);

-- Trigger actualizado_en (para campos de fecha que se actualizan)
CREATE OR REPLACE FUNCTION update_devoluciones_timestamps()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- No hay updated_at genérico; las fechas específicas se setean en la lógica de negocio
  RETURN NEW;
END $$;

-- RLS
ALTER TABLE devoluciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE devoluciones FORCE ROW LEVEL SECURITY;

-- Cliente ve sus devoluciones
DROP POLICY IF EXISTS devoluciones_cliente_own ON devoluciones;
CREATE POLICY devoluciones_cliente_own ON devoluciones
  FOR SELECT TO app_rls_user
  USING (solicitante_id = current_setting('app.current_user_id', true)::int);

-- Proveedor/salón ve devoluciones de sus pedidos
DROP POLICY IF EXISTS devoluciones_proveedor_own ON devoluciones;
CREATE POLICY devoluciones_proveedor_own ON devoluciones
  FOR SELECT TO app_rls_user
  USING (
    receptor_id = current_setting('app.current_user_id', true)::int
    OR receptor_id IS NULL  -- admin ve todas
  );

-- Admin ve todo
DROP POLICY IF EXISTS devoluciones_admin_all ON devoluciones;
CREATE POLICY devoluciones_admin_all ON devoluciones
  FOR ALL TO app_rls_user
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

-- Sistema (jobs, webhooks) tenant de plataforma
DROP POLICY IF EXISTS devoluciones_system_all ON devoluciones;
CREATE POLICY devoluciones_system_all ON devoluciones
  FOR ALL TO app_rls_user
  USING (tenant_id = current_setting('app.platform_tenant_id', true)::int)
  WITH CHECK (tenant_id = current_setting('app.platform_tenant_id', true)::int);

-- Comentarios
COMMENT ON TABLE devoluciones IS 'Logística inversa: devoluciones de clientes a proveedores/salones';
COMMENT ON COLUMN devoluciones.motivo IS 'Motivo estandarizado para analytics y reglas automáticas';
COMMENT ON COLUMN devoluciones.fotos_urls IS 'Evidencia fotográfica subida a Storage (bucket devoluciones)';
COMMENT ON COLUMN devoluciones.tipo_resolucion IS 'Resultado final: reembolso, cambio, nota crédito, etc.';
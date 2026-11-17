-- backend/migrations/172_extend_devoluciones_retorno.sql
-- Extiende la tabla devoluciones (migración 163) con campos para etiqueta de retorno,
-- carrier inverso, guía de retorno y trazabilidad de reembolso

-- Campos nuevos en devoluciones
ALTER TABLE devoluciones
    ADD COLUMN IF NOT EXISTS etiqueta_retorno_pdf_url TEXT,
    ADD COLUMN IF NOT EXISTS etiqueta_retorno_zpl TEXT,
    ADD COLUMN IF NOT EXISTS carrier_retorno VARCHAR(50),
    ADD COLUMN IF NOT EXISTS carrier_retorno_service_code VARCHAR(50),
    ADD COLUMN IF NOT EXISTS guia_retorno VARCHAR(100),
    ADD COLUMN IF NOT EXISTS guia_retorno_tracking_url TEXT,
    ADD COLUMN IF NOT EXISTS reembolso_id BIGINT,
    ADD COLUMN IF NOT EXISTS reembolso_estado VARCHAR(30) CHECK (reembolso_estado IN ('pendiente', 'procesando', 'completado', 'fallido', 'parcial')),
    ADD COLUMN IF NOT EXISTS reembolso_monto_cop BIGINT,
    ADD COLUMN IF NOT EXISTS reembolso_proveedor_ref VARCHAR(100), -- Stripe refund ID / Wompi refund ID
    ADD COLUMN IF NOT EXISTS reembolso_completado_en TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS inspeccion_notas TEXT,
    ADD COLUMN IF NOT EXISTS inspeccion_fotos JSONB DEFAULT '[]', -- Array de URLs
    ADD COLUMN IF NOT EXISTS inspeccion_estado VARCHAR(20) CHECK (inspeccion_estado IN ('pendiente', 'aprobada', 'rechazada', 'parcial')),
    ADD COLUMN IF NOT EXISTS inspeccionada_por BIGINT REFERENCES usuarios(id),
    ADD COLUMN IF NOT EXISTS inspeccionada_en TIMESTAMPTZ;

-- Índices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_devoluciones_guia_retorno ON devoluciones(guia_retorno) WHERE guia_retorno IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_devoluciones_reembolso ON devoluciones(reembolso_id) WHERE reembolso_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_devoluciones_carrier_retorno ON devoluciones(carrier_retorno) WHERE carrier_retorno IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_devoluciones_estado_inspeccion ON devoluciones(inspeccion_estado) WHERE inspeccion_estado IS NOT NULL;

-- RLS ya existe en migración 163 (hereda políticas), solo verificar
-- La tabla ya tiene RLS habilitado y políticas para app_rls_user / app_system

-- Comentarios
COMMENT ON COLUMN devoluciones.etiqueta_retorno_pdf_url IS 'URL PDF etiqueta de retorno (generada via Envíame carrier inverso)';
COMMENT ON COLUMN devoluciones.etiqueta_retorno_zpl IS 'ZPL raw para impresoras térmicas (retorno)';
COMMENT ON COLUMN devoluciones.carrier_retorno IS 'Carrier para retorno (puede ser distinto al de ida)';
COMMENT ON COLUMN devoluciones.guia_retorno IS 'Número de guía de retorno';
COMMENT ON COLUMN devoluciones.reembolso_id IS 'Referencia interna del reembolso (tabla reembolsos si existe, o ID transacción)';
COMMENT ON COLUMN devoluciones.reembolso_estado IS 'Estado del reembolso: pendiente, procesando, completado, fallido, parcial';
COMMENT ON COLUMN devoluciones.inspeccion_notas IS 'Notas del proveedor al recibir e inspeccionar la devolución';
COMMENT ON COLUMN devoluciones.inspeccion_fotos IS 'Array de URLs de fotos de la inspección';
COMMENT ON COLUMN devoluciones.inspeccion_estado IS 'Resultado inspección: pendiente, aprobada, rechazada, parcial';
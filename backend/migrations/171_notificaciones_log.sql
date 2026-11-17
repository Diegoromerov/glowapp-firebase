-- 171_notificaciones_log.sql
-- Auditoría de envíos de notificaciones (push, email, sms)

CREATE TABLE IF NOT EXISTS notificaciones_log (
    id BIGSERIAL PRIMARY KEY,
    usuario_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    tenant_id BIGINT NOT NULL,
    canal VARCHAR(20) NOT NULL, -- 'push', 'email', 'sms'
    evento_tipo VARCHAR(50) NOT NULL, -- 'envio_creado', 'recogido', 'en_transito', 'salida_entrega', 'entregado', 'fallido', 'devuelto', 'devolucion_solicitada', 'devolucion_aprobada', 'devolucion_rechazada', 'devolucion_recibida', 'devolucion_reembolsada'
    referencia_tipo VARCHAR(30), -- 'envio', 'devolucion', 'pedido'
    referencia_id BIGINT,
    asunto TEXT,
    cuerpo TEXT,
    estado_envio VARCHAR(20) NOT NULL DEFAULT 'pendiente', -- 'pendiente', 'enviado', 'fallido', 'rebotado'
    proveedor_respuesta JSONB, -- response del proveedor (FCM/SendGrid/Twilio)
    error_mensaje TEXT,
    intentos INT NOT NULL DEFAULT 0,
    enviado_en TIMESTAMPTZ,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_notif_log_usuario ON notificaciones_log(usuario_id);
CREATE INDEX IF NOT EXISTS idx_notif_log_tenant ON notificaciones_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notif_log_evento ON notificaciones_log(evento_tipo);
CREATE INDEX IF NOT EXISTS idx_notif_log_estado ON notificaciones_log(estado_envio);
CREATE INDEX IF NOT EXISTS idx_notif_log_creado ON notificaciones_log(creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_notif_log_referencia ON notificaciones_log(referencia_tipo, referencia_id);

-- RLS
ALTER TABLE notificaciones_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notif_log_isolation ON notificaciones_log;
CREATE POLICY notif_log_isolation ON notificaciones_log
    TO app_rls_user
    USING (
        usuario_id = current_setting('app.current_user_id', true)::bigint
        OR tenant_id = current_setting('app.tenant_id', true)::bigint
    )
    WITH CHECK (
        usuario_id = current_setting('app.current_user_id', true)::bigint
        OR tenant_id = current_setting('app.tenant_id', true)::bigint
    );

DROP POLICY IF EXISTS notif_log_system ON notificaciones_log;
CREATE POLICY notif_log_system ON notificaciones_log
    TO app_system
    USING (true) WITH CHECK (true);

-- Trigger actualizado_en
DROP TRIGGER IF EXISTS trg_notif_log_actualizado_en ON notificaciones_log;
CREATE TRIGGER trg_notif_log_actualizado_en
    BEFORE UPDATE ON notificaciones_log
    FOR EACH ROW EXECUTE FUNCTION fn_actualizado_en();
-- 170_usuario_notificaciones_prefs.sql
-- Preferencias de notificación por usuario y tipo de evento

-- La función debe existir antes de crear los triggers que la usan.
CREATE OR REPLACE FUNCTION fn_actualizado_en()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS usuario_notificaciones_prefs (
    id BIGSERIAL PRIMARY KEY,
    usuario_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    evento_tipo VARCHAR(50) NOT NULL, -- 'envio_creado', 'recogido', 'en_transito', 'salida_entrega', 'entregado', 'fallido', 'devuelto', 'devolucion_solicitada', 'devolucion_aprobada', 'devolucion_rechazada', 'devolucion_recibida', 'devolucion_reembolsada'
    canal VARCHAR(20) NOT NULL, -- 'push', 'email', 'sms'
    habilitado BOOLEAN NOT NULL DEFAULT true,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (usuario_id, evento_tipo, canal)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_usuario_notif_prefs_usuario ON usuario_notificaciones_prefs(usuario_id);
CREATE INDEX IF NOT EXISTS idx_usuario_notif_prefs_evento ON usuario_notificaciones_prefs(evento_tipo);

-- RLS
ALTER TABLE usuario_notificaciones_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuario_notif_prefs_isolation ON usuario_notificaciones_prefs;
CREATE POLICY usuario_notif_prefs_isolation ON usuario_notificaciones_prefs
    TO app_rls_user
    USING (
        usuario_id = current_setting('app.current_user_id', true)::bigint
        OR current_setting('app.tenant_id', true)::bigint = (SELECT tenant_id FROM usuarios WHERE id = usuario_notificaciones_prefs.usuario_id)
    )
    WITH CHECK (
        usuario_id = current_setting('app.current_user_id', true)::bigint
        OR current_setting('app.tenant_id', true)::bigint = (SELECT tenant_id FROM usuarios WHERE id = usuario_notificaciones_prefs.usuario_id)
    );

DROP POLICY IF EXISTS usuario_notif_prefs_system ON usuario_notificaciones_prefs;
CREATE POLICY usuario_notif_prefs_system ON usuario_notificaciones_prefs
    TO app_system
    USING (true) WITH CHECK (true);

-- Trigger actualizado_en
DROP TRIGGER IF EXISTS trg_usuario_notif_prefs_actualizado_en ON usuario_notificaciones_prefs;
CREATE TRIGGER trg_usuario_notif_prefs_actualizado_en
    BEFORE UPDATE ON usuario_notificaciones_prefs
    FOR EACH ROW EXECUTE FUNCTION fn_actualizado_en();

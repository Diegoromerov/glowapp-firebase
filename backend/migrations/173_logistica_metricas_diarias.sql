-- 173_logistica_metricas_diarias.sql
-- Tabla agregada / materialized view para métricas logísticas diarias por carrier/zona
-- Permite dashboard Grafana rápido sin agregaciones pesadas en tiempo real

-- Tabla física (refrescada por job nocturno o trigger)
CREATE TABLE IF NOT EXISTS logistica_metricas_diarias (
    id BIGSERIAL PRIMARY KEY,
    fecha DATE NOT NULL,
    carrier VARCHAR(50) NOT NULL,
    zona_id UUID REFERENCES zonas_envio(id),
    envios_creados BIGINT NOT NULL DEFAULT 0,
    envios_recogidos BIGINT NOT NULL DEFAULT 0,
    envios_entregados BIGINT NOT NULL DEFAULT 0,
    envios_fallidos BIGINT NOT NULL DEFAULT 0,
    envios_devueltos BIGINT NOT NULL DEFAULT 0,
    sla_promedio_horas NUMERIC(6,2), -- promedio horas CREADO→ENTREGADO
    sla_p50_horas NUMERIC(6,2),
    sla_p90_horas NUMERIC(6,2),
    sla_p99_horas NUMERIC(6,2),
    volumen_peso_kg NUMERIC(10,2) DEFAULT 0,
    valor_total_cop BIGINT DEFAULT 0,
    devoluciones_solicitadas BIGINT NOT NULL DEFAULT 0,
    devoluciones_completadas BIGINT NOT NULL DEFAULT 0,
    costo_etiquetas_cop BIGINT DEFAULT 0,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (fecha, carrier, zona_id)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_log_metricas_fecha ON logistica_metricas_diarias(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_log_metricas_carrier ON logistica_metricas_diarias(carrier);
CREATE INDEX IF NOT EXISTS idx_log_metricas_zona ON logistica_metricas_diarias(zona_id);

-- RLS
ALTER TABLE logistica_metricas_diarias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS log_metricas_isolation ON logistica_metricas_diarias;
CREATE POLICY log_metricas_isolation ON logistica_metricas_diarias
    TO app_rls_user
    USING (
        zona_id IS NULL
        OR zona_id = current_setting('app.tenant_id', true)::uuid
    )
    WITH CHECK (
        zona_id IS NULL
        OR zona_id = current_setting('app.tenant_id', true)::uuid
    );

DROP POLICY IF EXISTS log_metricas_system ON logistica_metricas_diarias;
CREATE POLICY log_metricas_system ON logistica_metricas_diarias
    TO app_system
    USING (true) WITH CHECK (true);

-- Trigger actualizado_en
DROP TRIGGER IF EXISTS trg_log_metricas_actualizado_en ON logistica_metricas_diarias;
CREATE TRIGGER trg_log_metricas_actualizado_en
    BEFORE UPDATE ON logistica_metricas_diarias
    FOR EACH ROW EXECUTE FUNCTION fn_actualizado_en();

-- Función para refrescar métricas diarias (llamar desde job nocturno)
CREATE OR REPLACE FUNCTION refrescar_logistica_metricas_diarias(p_fecha DATE DEFAULT CURRENT_DATE - INTERVAL '1 day')
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    -- Upsert métricas del día anterior
    INSERT INTO logistica_metricas_diarias (
        fecha, carrier, zona_id,
        envios_creados, envios_recogidos, envios_entregados,
        envios_fallidos, envios_devueltos,
        sla_promedio_horas, sla_p50_horas, sla_p90_horas, sla_p99_horas,
        volumen_peso_kg, valor_total_cop,
        devoluciones_solicitadas, devoluciones_completadas,
        costo_etiquetas_cop
    )
    SELECT
        DATE(e.creado_en) AS fecha,
        e.transportadora AS carrier,
        ze.id AS zona_id,
        COUNT(*) FILTER (WHERE e.estado = 'CREADO') AS envios_creados,
        COUNT(*) FILTER (WHERE e.estado IN ('RECOGIDO','EN_TRANSITO','EN_CENTRO_DESTINO','SALIDA_ENTREGA','ENTREGADO')) AS envios_recogidos,
        COUNT(*) FILTER (WHERE e.estado = 'ENTREGADO') AS envios_entregados,
        COUNT(*) FILTER (WHERE e.estado = 'FALLIDO') AS envios_fallidos,
        COUNT(*) FILTER (WHERE e.estado = 'DEVUELTO') AS envios_devueltos,
        AVG(EXTRACT(EPOCH FROM (e.entregado_en - e.creado_en))/3600) FILTER (WHERE e.estado = 'ENTREGADO') AS sla_promedio_horas,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (e.entregado_en - e.creado_en))/3600) FILTER (WHERE e.estado = 'ENTREGADO') AS sla_p50_horas,
        PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (e.entregado_en - e.creado_en))/3600) FILTER (WHERE e.estado = 'ENTREGADO') AS sla_p90_horas,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (e.entregado_en - e.creado_en))/3600) FILTER (WHERE e.estado = 'ENTREGADO') AS sla_p99_horas,
        COALESCE(SUM(e.peso_kg), 0) AS volumen_peso_kg,
        COALESCE(SUM(pt.total), 0) AS valor_total_cop,
        COUNT(d.id) FILTER (WHERE d.estado = 'SOLICITADA' AND DATE(d.creado_en) = DATE(e.creado_en)) AS devoluciones_solicitadas,
        COUNT(d.id) FILTER (WHERE d.estado = 'RESUELTA' AND DATE(d.actualizado_en) = DATE(e.creado_en)) AS devoluciones_completadas,
        COALESCE(SUM(e.costo_etiqueta_cop), 0) AS costo_etiquetas_cop
    FROM envios e
    LEFT JOIN pedidos_tienda pt ON pt.id = e.pedido_id
    LEFT JOIN zonas_envio ze ON ze.ciudad = e.destino_ciudad AND ze.departamento = e.destino_departamento
    LEFT JOIN devoluciones d ON d.pedido_id = pt.id
    WHERE DATE(e.creado_en) = p_fecha
    GROUP BY DATE(e.creado_en), e.transportadora, ze.id
    ON CONFLICT (fecha, carrier, zona_id) DO UPDATE SET
        envios_creados = EXCLUDED.envios_creados,
        envios_recogidos = EXCLUDED.envios_recogidos,
        envios_entregados = EXCLUDED.envios_entregados,
        envios_fallidos = EXCLUDED.envios_fallidos,
        envios_devueltos = EXCLUDED.envios_devueltos,
        sla_promedio_horas = EXCLUDED.sla_promedio_horas,
        sla_p50_horas = EXCLUDED.sla_p50_horas,
        sla_p90_horas = EXCLUDED.sla_p90_horas,
        sla_p99_horas = EXCLUDED.sla_p99_horas,
        volumen_peso_kg = EXCLUDED.volumen_peso_kg,
        valor_total_cop = EXCLUDED.valor_total_cop,
        devoluciones_solicitadas = EXCLUDED.devoluciones_solicitadas,
        devoluciones_completadas = EXCLUDED.devoluciones_completadas,
        costo_etiquetas_cop = EXCLUDED.costo_etiquetas_cop,
        actualizado_en = NOW();
END $$;

COMMENT ON TABLE logistica_metricas_diarias IS 'Métricas logísticas pre-agregadas por día/carrier/zona para dashboard Grafana';
COMMENT ON FUNCTION refrescar_logistica_metricas_diarias IS 'Refresca métricas del día indicado (por defecto ayer). Llamar desde cron nocturno.';
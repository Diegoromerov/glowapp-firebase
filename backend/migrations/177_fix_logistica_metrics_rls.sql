-- 177_fix_logistica_metrics_rls.sql
-- Repara bases donde la migración 173 ya fue aplicada y el runner la omitirá.
-- zona_id no representa tenant_id; solo app_system puede usar estas métricas
-- hasta que exista un vínculo explícito entre zonas y tenants.

CREATE OR REPLACE FUNCTION fn_actualizado_en()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP POLICY IF EXISTS log_metricas_isolation ON logistica_metricas_diarias;
CREATE POLICY log_metricas_isolation ON logistica_metricas_diarias
    TO app_rls_user
    USING (false)
    WITH CHECK (false);

DROP POLICY IF EXISTS log_metricas_system ON logistica_metricas_diarias;
CREATE POLICY log_metricas_system ON logistica_metricas_diarias
    TO app_system
    USING (true)
    WITH CHECK (true);

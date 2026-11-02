-- Migración para crear tablas de audit trail de retención
-- Se ejecuta como migración independiente

-- 1. Tabla principal de audit trail de retención
CREATE TABLE IF NOT EXISTS retention_audit_log (
    id SERIAL PRIMARY KEY,
    execution_id UUID NOT NULL DEFAULT gen_random_uuid(),
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL CHECK (status IN ('SUCCESS', 'PARTIAL_ERROR', 'TOTAL_ERROR')),
    total_evaluated INTEGER NOT NULL DEFAULT 0,
    total_affected INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabla de detalle de audit trail por categoría
CREATE TABLE IF NOT EXISTS retention_audit_log_detail (
    id SERIAL PRIMARY KEY,
    log_id INTEGER NOT NULL REFERENCES retention_audit_log(id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL,
    operation VARCHAR(20) NOT NULL CHECK (operation IN ('DELETE', 'ANONYMIZE')),
    evaluated_count INTEGER NOT NULL DEFAULT 0,
    affected_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para mejorar el rendimiento de consultas de audit
CREATE INDEX IF NOT EXISTS idx_retention_audit_log_execution_id ON retention_audit_log(execution_id);
CREATE INDEX IF NOT EXISTS idx_retention_audit_log_detail_log_id ON retention_audit_log_detail(log_id);
CREATE INDEX IF NOT EXISTS idx_retention_audit_log_detail_category ON retention_audit_log_detail(category);
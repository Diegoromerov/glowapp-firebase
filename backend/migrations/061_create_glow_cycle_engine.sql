-- backend/migrations/061_create_glow_cycle_engine.sql
-- Misión GIA-01: Creación del núcleo del Glow Cycle Engine

BEGIN;

CREATE TABLE IF NOT EXISTS glow_cycles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    cycle_type VARCHAR(50) NOT NULL DEFAULT 'skin', -- 'skin', 'hands', 'color', 'hair', 'beauty_goal'
    status VARCHAR(30) NOT NULL DEFAULT 'active', -- 'active', 'reassessment_due', 'completed', 'abandoned'
    target_goal VARCHAR(255) NOT NULL,
    target_metric_key VARCHAR(50), -- ej. 'hydration', 'pores', 'spots', 'wrinkles'
    baseline_value NUMERIC(5,2),
    target_value NUMERIC(5,2),
    current_value NUMERIC(5,2),
    duration_days INTEGER NOT NULL DEFAULT 30,
    start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    end_date TIMESTAMP WITH TIME ZONE,
    plan_summary TEXT,
    am_routine JSONB DEFAULT '[]'::jsonb,
    pm_routine JSONB DEFAULT '[]'::jsonb,
    recommended_product_ids JSONB DEFAULT '[]'::jsonb,
    recommended_service_ids JSONB DEFAULT '[]'::jsonb,
    checkin_history JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS glow_cycle_measurements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_id UUID NOT NULL REFERENCES glow_cycles(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    measurement_type VARCHAR(30) NOT NULL, -- 'baseline', 'milestone_15d', 'final_30d', 'reassessment'
    day_number INTEGER NOT NULL DEFAULT 1,
    encrypted_scores TEXT NOT NULL,
    score_delta JSONB DEFAULT '{}'::jsonb,
    ai_evaluation_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices de rendimiento y consultas de usuario
CREATE INDEX IF NOT EXISTS idx_glow_cycles_user_id_status ON glow_cycles(user_id, status);
CREATE INDEX IF NOT EXISTS idx_glow_cycle_measurements_cycle_id ON glow_cycle_measurements(cycle_id);

COMMIT;

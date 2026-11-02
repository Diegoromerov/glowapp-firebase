-- ============================================================
-- MIGRACIÓN 002: Historial de Diagnósticos e Ideas IA
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_diagnostics (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  tool_type VARCHAR(50) NOT NULL, -- 'skin-tone', 'hair-diagnostic', 'skin-texture', 'eyebrow-visagism', 'nails-style'
  result_data JSONB NOT NULL,
  image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

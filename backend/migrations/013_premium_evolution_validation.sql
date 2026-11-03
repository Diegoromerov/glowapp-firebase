-- backend/migrations/013_premium_evolution_validation.sql
-- Migración para el Área Premium: Validación Médica de Diagnósticos IA

CREATE TABLE IF NOT EXISTS validaciones_medicas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  ai_diagnostic_id INTEGER REFERENCES ai_diagnostics(id) ON DELETE SET NULL,
  profesional_id UUID REFERENCES profesionales_medicos(id) ON DELETE CASCADE,
  estado VARCHAR(20) DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'revisado')),
  nota_profesional TEXT,
  payment_reference VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  fecha_respuesta TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_validaciones_medicas_user ON validaciones_medicas(user_id);

-- Seed historical diagnostics for the test user usuario_pruebas@gmail.com if they exist
DO $$
DECLARE
  test_user_id INTEGER;
BEGIN
  SELECT id INTO test_user_id FROM usuarios WHERE email = 'usuario_pruebas@gmail.com';
  
  IF test_user_id IS NOT NULL THEN
    -- Inserción del diagnóstico 1 (hace 14 días): Piel deshidratada y con impurezas
    INSERT INTO ai_diagnostics (user_id, tool_type, score_hidratacion, score_impurezas, score_luminosidad, track, created_at, result_data, image_url)
    SELECT test_user_id, 'care-routine', 42, 75, 48, 'piel', NOW() - INTERVAL '14 days', 
           '{"skin_type": "Piel Mixta (Deshidratada)", "scalp_status": "Seco", "explanation": "Tu piel muestra signos de deshidratación moderada y acumulación de impurezas en la zona T.", "recommended_routine": ["Paso 1: Limpiador suave", "Paso 2: Sérum hidratante", "Paso 3: Bloqueador solar"]}'::jsonb,
           (SELECT foto_url FROM usuarios WHERE id = test_user_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM ai_diagnostics WHERE user_id = test_user_id AND created_at < NOW() - INTERVAL '10 days'
    );

    -- Inserción del diagnóstico 2 (hoy): Piel hidratada y limpia (resultado actual)
    INSERT INTO ai_diagnostics (user_id, tool_type, score_hidratacion, score_impurezas, score_luminosidad, track, created_at, result_data, image_url)
    SELECT test_user_id, 'care-routine', 85, 22, 90, 'piel', NOW(), 
           '{"skin_type": "Piel Mixta (Hidratada)", "scalp_status": "Normal", "explanation": "Tu piel ha mejorado notablemente. Se observa una óptima barrera cutánea con alta luminosidad y poros limpios.", "recommended_routine": ["Paso 1: Limpiador suave", "Paso 2: Sérum de Ácido Hialurónico", "Paso 3: Hidratante ligero con FPS"]}'::jsonb,
           (SELECT foto_url FROM usuarios WHERE id = test_user_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM ai_diagnostics WHERE user_id = test_user_id AND created_at >= NOW() - INTERVAL '1 day'
    );

    -- También actualizamos el skin_profile del usuario
    INSERT INTO skin_profiles (user_id, tipo_piel, hidratacion_promedio, tendencia_acne, sensibilidad_score, diagnosticos_count, ultimo_diagnostico_at)
    VALUES (test_user_id, 'Piel Mixta', 63, 48, 30, 2, NOW())
    ON CONFLICT (user_id) DO UPDATE 
    SET tipo_piel = 'Piel Mixta', hidratacion_promedio = 63, tendencia_acne = 48, sensibilidad_score = 30, diagnosticos_count = 2, ultimo_diagnostico_at = NOW();

  END IF;
END $$;

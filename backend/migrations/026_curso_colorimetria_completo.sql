-- migrations/026_curso_colorimetria_completo.sql
-- Estructuración final e infraestructura digital para Glow Academy Pro

-- 1. Asegurar la tabla de Consentimiento de Habeas Data e Imágenes Prácticas
CREATE TABLE IF NOT EXISTS academy_consentimientos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id INT NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
    aceptado BOOLEAN NOT NULL DEFAULT FALSE,
    fecha_aceptacion TIMESTAMPTZ DEFAULT NOW(),
    fecha_revocacion TIMESTAMPTZ
);

-- 2. Asegurar la tabla de Respuestas de Hojas de Trabajo Práctico (Worksheets)
CREATE TABLE IF NOT EXISTS academy_worksheet_submissions (
    provider_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    lesson_id UUID NOT NULL REFERENCES academy_lessons(id) ON DELETE CASCADE,
    respuestas_texto JSONB NOT NULL DEFAULT '{}',
    evidencia_foto_url VARCHAR(500),
    consentimiento_id UUID REFERENCES academy_consentimientos(id),
    enviado_at TIMESTAMPTZ DEFAULT NOW(),
    calificado BOOLEAN NOT NULL DEFAULT FALSE,
    calificacion_nota VARCHAR(50),
    retroalimentacion TEXT,
    PRIMARY KEY (provider_id, lesson_id)
);

-- 3. Tabla para Registro de Discrepancias del Motor de Inteligencia Artificial (Módulo 6)
CREATE TABLE IF NOT EXISTS academy_ai_discrepancy_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    leccion_id UUID NOT NULL REFERENCES academy_lessons(id) ON DELETE CASCADE,
    diagnostico_ia JSONB NOT NULL,
    criterio_humano JSONB NOT NULL,
    comentarios TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Semilla de Estructuración del Curso de Colorimetría
-- Asegurar que existe el curso principal en academy_courses
-- NOTA (fix 2026-09-22): el seed de este archivo se re-ejecuta en CADA arranque del backend.
-- Debe ser NO destructivo (DO NOTHING): antes usaba DO UPDATE sobre IDs que también declaraba
-- 008, y como el seed solo actualizaba title/sort_order/content_text, dejaba módulos y lecciones
-- de otros cursos con títulos ajenos (colisión de UUID). La estructura canónica del curso de
-- colorimetría se garantiza en 066_fix_academia_curriculum.sql.
INSERT INTO academy_courses (id, title, description, category, badge_name) VALUES
('c0000000-0000-0000-0000-000000000003', 'Especialista en Colorimetría Avanzada y Tendencias de Color', 'Domina la teoría del color, decoloraciones seguras, subtonos de piel, neutralización y diagnóstico asistido por IA para potenciar tu portafolio.', 'color', 'Experta Colorista Glow')
ON CONFLICT (id) DO NOTHING;

-- Insertar los 9 módulos secuenciales del curso (Módulo 0 al Módulo 8)
INSERT INTO academy_modules (id, course_id, title, sort_order) VALUES
('b0000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-000000000003', 'Módulo 0: Bienvenida y Consentimiento de Datos', 0),
('b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003', 'Módulo 1: Fundamentos de la Teoría del Color', 1),
('b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003', 'Módulo 2: Colorimetría Capilar: Niveles y Tonos', 2),
('b0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'Módulo 3: Colorimetría Facial y Subtono de Piel', 3),
('b0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000003', 'Módulo 4: Diagnóstico Práctico: Casos Reales', 4),
('b0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000003', 'Módulo 5: Corrección de Color y Neutralización', 5),
('b0000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-000000000003', 'Módulo 6: Uso del Módulo IA de Colorimetría de GlowApp', 6),
('b0000000-0000-0000-0000-000000000007', 'c0000000-0000-0000-0000-000000000003', 'Módulo 7: Asesoría de Venta y Comunicación', 7),
('b0000000-0000-0000-0000-000000000008', 'c0000000-0000-0000-0000-000000000003', 'Módulo 8: Evaluación Final y Certificación', 8)
ON CONFLICT (id) DO NOTHING;

-- Insertar Lecciones marcadoras para cada módulo (Lecciones en Blanco)
INSERT INTO academy_lessons (id, module_id, title, video_url, content_text, sort_order) VALUES
-- Módulo 0
('a0000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000000', 'Bienvenida y Firma de Consentimiento Informado', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'CONTENIDO_LECCION_MODULO_0_BIENVENIDA_AQUI', 1),
-- Módulo 1
('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '1. La Rueda Cromática Interactiva', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'CONTENIDO_LECCION_MODULO_1_RUEDA_AQUI', 1),
('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', '2. Matiz, Valor e Intensidad', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'CONTENIDO_LECCION_MODULO_1_PROPIEDADES_AQUI', 2),
('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', '3. La Química de las Melaninas', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'CONTENIDO_LECCION_MODULO_1_MELANINAS_AQUI', 3),
-- Módulo 2
('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000002', '1. Escala Internacional de Alturas de Tono', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'CONTENIDO_LECCION_MODULO_2_ESCALA_AQUI', 1),
('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000002', '2. El Test de Porosidad y Elasticidad', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'CONTENIDO_LECCION_MODULO_2_POROSIDAD_AQUI', 2),
-- Módulo 3
('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000003', '1. Sobretono vs. Subtono Vascular', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'CONTENIDO_LECCION_MODULO_3_SUBTONO_AQUI', 1),
('a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000003', '2. El Método de las 4 Estaciones de Color', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'CONTENIDO_LECCION_MODULO_3_ESTACIONES_AQUI', 2),
-- Módulo 4
('a0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000004', 'Ejercicios de Simulación con 5 Casos Reales', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'CONTENIDO_LECCION_MODULO_4_CASOS_AQUI', 1),
-- Módulo 5
('a0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000005', '1. Fórmulas de Corrección de Color', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'CONTENIDO_LECCION_MODULO_5_FORMULAS_AQUI', 1),
('a0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000005', '2. El Kit de Emergencia de la Estilista', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'CONTENIDO_LECCION_MODULO_5_KIT_AQUI', 2),
-- Módulo 6
('a0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000006', '1. Fotografía Técnica y Calidad de Imagen', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'CONTENIDO_LECCION_MODULO_6_FOTOGRAFIA_AQUI', 1),
('a0000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-000000000006', '2. Calibración del Escáner y AI Logs', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'CONTENIDO_LECCION_MODULO_6_CALIBRACION_AQUI', 2),
-- Módulo 7
('a0000000-0000-0000-0000-000000000013', 'b0000000-0000-0000-0000-000000000007', '1. Protocolo de Venta Ética de 4 Pasos', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'CONTENIDO_LECCION_MODULO_7_VENTA_AQUI', 1),
-- Módulo 8
('a0000000-0000-0000-0000-000000000014', 'b0000000-0000-0000-0000-000000000008', 'Examen Final Integrador y Entrega de Portafolio', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'CONTENIDO_LECCION_MODULO_8_EXAMEN_AQUI', 1)
ON CONFLICT (id) DO NOTHING;

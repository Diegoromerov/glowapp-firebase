-- migrations/008_academia_glow.sql
-- Tablas para el aula virtual (Academia Glow)

CREATE TABLE IF NOT EXISTS academy_courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(100) NOT NULL,
  badge_name VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS academy_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES academy_courses(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  sort_order INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS academy_lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL REFERENCES academy_modules(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  video_url VARCHAR(255),
  content_text TEXT,
  sort_order INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS academy_progress (
  provider_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES academy_lessons(id) ON DELETE CASCADE,
  completed BOOLEAN NOT NULL DEFAULT TRUE,
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (provider_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS academy_quizzes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES academy_courses(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  options JSONB NOT NULL, -- Lista de opciones ['Opción A', 'Opción B', ...]
  correct_index INT NOT NULL -- Índice de la respuesta correcta (0-indexed)
);

-- Semilla de Datos de Ejemplo (Seed)
INSERT INTO academy_courses (id, title, description, category, badge_name) VALUES
('c0000000-0000-0000-0000-000000000001', 'Protocolos de Bioseguridad y Calidad Glow', 'Curso obligatorio para conocer los estándares de higiene, desinfección y atención premium a domicilio.', 'bioseguridad', 'Profesional Certificada Glow')
ON CONFLICT (id) DO NOTHING;

-- NOTA (fix 2026-09-22): los UUID de módulos/lecciones de los cursos 1 y 2 se movieron al
-- namespace d1…/d2… para que NO colisionen con los del curso 3 (b…/a… definidos en 025/026).
-- La colisión anterior hacía que 026 renombrara/reasignara módulos de estos cursos en cada arranque.
INSERT INTO academy_modules (id, course_id, title, sort_order) VALUES
('d1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Módulo 1: Protocolo de Bioseguridad', 1),
('d1000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'Módulo 2: Experiencia Premium al Cliente', 2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO academy_lessons (id, module_id, title, video_url, content_text, sort_order) VALUES
('d2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', '1. Esterilización del Instrumental', NULL, 'Es fundamental esterilizar todas las herramientas metálicas antes de cada servicio utilizando autoclaves o esterilizadores térmicos. Limpia primero con jabón enzimático.', 1),
('d2000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000001', '2. Uso de Elementos de Protección Personal', NULL, 'El uso de tapabocas, guantes de nitrilo y delantal antifluido es obligatorio durante toda la sesión para protegerte a ti y al cliente.', 2),
('d2000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000002', '3. Puntualidad y Presentación Personal', NULL, 'Llegar 5 minutos antes demuestra profesionalismo. Viste el uniforme oficial de GlowApp limpio y mantén una actitud cortés y empática en el hogar del cliente.', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO academy_quizzes (id, course_id, question, options, correct_index) VALUES
('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', '¿Con qué frecuencia deben esterilizarse las herramientas de manicura?', '["Una vez al día", "Antes de cada servicio con cada cliente", "Semanalmente", "Solo si se ven sucias"]'::jsonb, 1),
('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', '¿Qué prenda de protección es obligatoria durante la atención?', '["Delantal plástico de cocina", "Tapabocas y guantes de nitrilo", "Gafas de sol", "Ninguna es obligatoria"]'::jsonb, 1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS academy_certificates (
  provider_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES academy_courses(id) ON DELETE CASCADE,
  obtained_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (provider_id, course_id)
);

-- Semilla del segundo curso
INSERT INTO academy_courses (id, title, description, category, badge_name) VALUES
('c0000000-0000-0000-0000-000000000002', 'Diseños Avanzados de Manicura (Gel-X y Nail Art)', 'Domina las extensiones Gel-X y la pintura a mano alzada para aumentar tus tarifas por servicio.', 'uñas', 'Maestra de Nail Art')
ON CONFLICT (id) DO NOTHING;

INSERT INTO academy_modules (id, course_id, title, sort_order) VALUES
('d1000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000002', 'Módulo 1: Gel-X Avanzado', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO academy_lessons (id, module_id, title, video_url, content_text, sort_order) VALUES
('d2000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-000000000003', '1. Preparación de la Uña Natural', NULL, 'Realiza una manicura seca meticulosa y deshidrata la placa de la uña para asegurar una adherencia perfecta de los tips Gel-X sin desprendimiento prematuro.', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO academy_quizzes (id, course_id, question, options, correct_index) VALUES
('e0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000002', '¿Qué es clave antes de aplicar tips Gel-X para evitar desprendimientos?', '["Primer sin ácido", "Deshidratar y preparar la placa de la uña natural", "Limar con fuerza hasta debilitar la uña", "No es necesaria preparación"]'::jsonb, 1)
ON CONFLICT (id) DO NOTHING;


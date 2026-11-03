-- migrations/025_curso_colorimetria_cabello.sql
-- Curso de Colorimetría de la Academia Glow: alta del curso y de su banco de preguntas.
--
-- FIX 2026-09-22 (auditoría, hallazgo B1): esta migración declaraba además el módulo
-- b…0004/b…0005 y las lecciones a…0005/a…0006/a…0007 con un module_id DISTINTO al que
-- declaran 026 y 066 para esos mismos UUID. Como los seeds se re-ejecutaban en cada
-- arranque, el resultado dependía del orden de aplicación y dejaba lecciones en el
-- módulo equivocado. El currículo (módulos y lecciones) tiene un ÚNICO dueño:
--   026_curso_colorimetria_completo.sql  +  066_fix_academia_curriculum_and_content.sql
-- Aquí queda solo lo que es exclusivo de esta migración: el curso (idempotente) y
-- las 2 preguntas de examen.

INSERT INTO academy_courses (id, title, description, category, badge_name) VALUES
('c0000000-0000-0000-0000-000000000003', 'Especialista en Colorimetría Avanzada y Tendencias de Color', 'Domina la teoría del color, decoloraciones seguras, formulación de tinturas y las últimas tendencias (Balayage, Babylights) para potenciar tu portafolio de estilista.', 'color', 'Experta Colorista Glow')
ON CONFLICT (id) DO NOTHING;

-- Examen / Quizzes
INSERT INTO academy_quizzes (id, course_id, question, options, correct_index) VALUES
('e0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000003', '¿Qué pigmento se debe utilizar para neutralizar un reflejo naranja no deseado en el cabello?', '["Pigmento rojo", "Pigmento azul", "Pigmento amarillo", "Pigmento violeta"]'::jsonb, 1),
('e0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000003', 'Si decoloramos el cabello y obtenemos un fondo de aclaración altura 9 (amarillo claro), ¿cuál es el matizador ideal para un rubio platinado cenizo?', '["Un matizador cobre", "Un matizador violeta/iridiscente", "Un matizador rojo", "No se necesita matizar"]'::jsonb, 1)
ON CONFLICT (id) DO NOTHING;

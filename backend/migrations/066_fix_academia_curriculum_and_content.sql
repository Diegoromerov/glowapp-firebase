-- migrations/066_fix_academia_curriculum_and_content.sql
-- ============================================================================
-- Reparación del daño de datos de la Academia Glow (auditoría 2026-09-22).
--
-- CAUSA: 008 y 026 declaraban los MISMOS UUID de módulos/lecciones
-- (b0000000-…-0001..0003, a0000000-…-0001..0007) pero con distinto course_id /
-- module_id, y 026 usaba `ON CONFLICT (id) DO UPDATE SET title, sort_order`
-- (nunca course_id/module_id). Resultado en cada arranque del backend:
--   · curso …0001 (Bioseguridad) quedaba con módulos y lecciones de teoría del color
--   · curso …0002 (Gel-X) quedaba con el "Módulo 3: Colorimetría Facial"
--   · curso …0003 (Colorimetría) perdía los módulos 1, 2 y 3 y 4 de sus 15 lecciones
--
-- ESTA MIGRACIÓN:
--   1. Define la estructura CANÓNICA del curso …0003 (9 módulos, 15 lecciones) con
--      UPSERT explícito de course_id/module_id/title/sort_order → converge tanto en
--      instalaciones nuevas como en la base de producción ya corrupta.
--   2. Sanea los datos de relleno que se filtraban a la UI: video_url apuntando al
--      mismo video placeholder (dQw4w9WgXcQ) y content_text tipo CONTENIDO_LECCION_*.
--
-- Es idempotente: se puede ejecutar en cada arranque sin efectos adicionales.
-- Los cursos …0001 y …0002 usan el namespace d1…/d2… definido en 008 (sin colisión).
-- ============================================================================

-- 1) Módulos canónicos del curso de colorimetría -----------------------------
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
ON CONFLICT (id) DO UPDATE
  SET course_id  = EXCLUDED.course_id,
      title      = EXCLUDED.title,
      sort_order = EXCLUDED.sort_order;

-- 2) Lecciones canónicas del curso de colorimetría ---------------------------
INSERT INTO academy_lessons (id, module_id, title, sort_order) VALUES
('a0000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000000', 'Bienvenida y Firma de Consentimiento Informado', 1),
('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '1. La Rueda Cromática Interactiva', 1),
('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', '2. Matiz, Valor e Intensidad', 2),
('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', '3. La Química de las Melaninas', 3),
('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000002', '1. Escala Internacional de Alturas de Tono', 1),
('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000002', '2. El Test de Porosidad y Elasticidad', 2),
('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000003', '1. Sobretono vs. Subtono Vascular', 1),
('a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000003', '2. El Método de las 4 Estaciones de Color', 2),
('a0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000004', 'Ejercicios de Simulación con 5 Casos Reales', 1),
('a0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000005', '1. Fórmulas de Corrección de Color', 1),
('a0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000005', '2. El Kit de Emergencia de la Estilista', 2),
('a0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000006', '1. Fotografía Técnica y Calidad de Imagen', 1),
('a0000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-000000000006', '2. Calibración del Escáner y AI Logs', 2),
('a0000000-0000-0000-0000-000000000013', 'b0000000-0000-0000-0000-000000000007', '1. Protocolo de Venta Ética de 4 Pasos', 1),
('a0000000-0000-0000-0000-000000000014', 'b0000000-0000-0000-0000-000000000008', 'Examen Final Integrador y Entrega de Portafolio', 1)
ON CONFLICT (id) DO UPDATE
  SET module_id  = EXCLUDED.module_id,
      title      = EXCLUDED.title,
      sort_order = EXCLUDED.sort_order;

-- 3) Saneamiento de contenido de relleno ------------------------------------
-- 3.a Ninguna lección debe apuntar a un video genérico: el reproductor real se
--     configura por lección desde el panel de administración.
UPDATE academy_lessons
   SET video_url = NULL
 WHERE video_url IS NOT NULL
   AND (video_url LIKE '%dQw4w9WgXcQ%' OR video_url LIKE '%example.com%');

-- 3.b Los marcadores internos de migración no deben llegar al alumno.
UPDATE academy_lessons
   SET content_text = 'Contenido en preparación. Esta lección se publicará con el material didáctico del módulo.'
 WHERE content_text IS NULL
    OR content_text = ''
    OR content_text LIKE 'CONTENIDO_LECCION%';

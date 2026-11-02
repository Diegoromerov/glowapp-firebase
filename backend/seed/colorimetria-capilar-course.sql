-- backend/seed/colorimetria-capilar-course.sql
-- ============================================
-- CURSO: COLORIMETRÍA CAPILAR PROFESIONAL
-- ============================================

-- 1. CREACIÓN DEL CURSO PRINCIPAL
INSERT INTO academy_courses (id, title, slug, description, category, thumbnail_url, duration_hours, level, is_published, created_at, updated_at)
VALUES 
(1, 
'Colorimetría Capilar Profesional', 
'colorimetria-capilar-profesional',
'Domina el arte del color en el cabello. Aprende desde los fundamentos científicos hasta las técnicas más avanzadas de coloración, decoloración y corrección de tono. Conviértete en un colorista certificado.',
'Color de cabello',
'https://images.unsplash.com/photo-1562322140-8baeececf3df?w=800',
40,
'beginner-to-advanced',
true,
NOW(),
NOW());

-- 2. MÓDULOS DEL CURSO
INSERT INTO academy_modules (id, course_id, title, description, position, created_at)
VALUES 
(1, 1, 'Fundamentos de Colorimetría', 'Bases científicas del color y estructura del cabello', 1, NOW()),
(2, 1, 'Técnicas de Aplicación', 'Métodos profesionales de coloración y decoloración', 2, NOW()),
(3, 1, 'Nivelación y Matización', 'Dominio del círculo cromático y corrección de tonos', 3, NOW()),
(4, 1, 'Técnicas Avanzadas', 'Mechas, balayage, contouring y tendencias actuales', 4, NOW());

-- 3. LECCIONES - MÓDULO 1: FUNDAMENTOS
INSERT INTO academy_lessons (id, module_id, title, content, video_url, position, duration_minutes, is_free, created_at)
VALUES
(1, 1, 'Introducción a la Colorimetría Capilar', 
'La colorimetría capilar es la ciencia que estudia el color del cabello y sus reacciones químicas.

**Tipos de Melanina:**
- Eumelanina: Pigmentos oscuros (negro y café)
- Feomelanina: Pigmentos claros (rojo y amarillo)

La proporción de estos pigmentos determina el color natural del cabello.',
'https://www.youtube.com/embed/dQw4w9WgXcQ', 1, 15, true, NOW()),

(2, 1, 'Estructura del Cabello',
'El cabello está compuesto principalmente por:

**1. Cutícula:** Capa externa protectora
**2. Corteza:** Capa intermedia que contiene la melanina
**3. Médula:** Capa interna

**Importancia del pH:**
El pH del cabello oscila entre 4.5 y 5.5. Los productos alcalinos abren la cutícula permitiendo la penetración del color.',
'https://www.youtube.com/embed/dQw4w9WgXcQ', 2, 20, false, NOW()),

(3, 1, 'La Teoría del Color',
'**Colores Primarios:**
- Azul, Rojo, Amarillo

**Colores Secundarios:**
- Naranja (Rojo + Amarillo)
- Verde (Azul + Amarillo)
- Violeta (Azul + Rojo)

**Círculo Cromático:**
Herramienta fundamental para entender las relaciones entre colores.',
'https://www.youtube.com/embed/dQw4w9WgXcQ', 3, 25, false, NOW()),

(4, 1, 'Alturas de Tono - Escala del 1 al 10',
'**1** - Negro
**2** - Moreno
**3** - Castaño oscuro
**4** - Castaño medio
**5** - Castaño claro
**6** - Rubio oscuro
**7** - Rubio medio
**8** - Rubio claro
**9** - Rubio muy claro
**10** - Rubio extra claro/Platino',
'https://www.youtube.com/embed/dQw4w9WgXcQ', 4, 18, false, NOW()),

(5, 1, 'Reflejos y Subtonos',
'**Reflejos Comunes:**
.0 o .1 - Natural/Cenizo
.3 - Dorado
.4 - Cobre
.5 - Caoba
.6 - Rojo
.7 - Marrón/Chocolate
.8 - Perlado/Azul
.9 - Violeta',
'https://www.youtube.com/embed/dQw4w9WgXcQ', 5, 22, false, NOW());

-- 4. LECCIONES - MÓDULO 2: TÉCNICAS
INSERT INTO academy_lessons (id, module_id, title, content, video_url, position, duration_minutes, is_free, created_at)
VALUES
(6, 2, 'Tipos de Tintes y Productos',
'**Tintes Permanentes:**
- Penetran en la corteza
- Requieren oxidante
- Duración permanente

**Oxidantes (Volúmenes):**
- 10 vol: Depositar color
- 20 vol: Cobertura de canas
- 30 vol: Aclarar 3 niveles
- 40 vol: Aclarar máximo 4 niveles',
'https://www.youtube.com/embed/dQw4w9WgXcQ', 1, 20, false, NOW()),

(7, 2, 'Preparación y Diagnóstico Capilar',
'**Evaluación Inicial:**
1. Historial Capilar
2. Prueba de Mechón
3. Prueba de Alergia (48h antes)
4. Diagnóstico Visual (porosidad, elasticidad, densidad)',
'https://www.youtube.com/embed/dQw4w9WgXcQ', 2, 15, false, NOW()),

(8, 2, 'Técnica de Aplicación de Color',
'**Pasos Profesionales:**
1. Iniciar en nuca (zona más fría)
2. Aplicar en raíces primero
3. Dejar últimos 2 cm de puntas
4. Esperar 20 minutos
5. Aplicar en largos y puntas
6. Tiempo total: 35-45 min',
'https://www.youtube.com/embed/dQw4w9WgXcQ', 3, 25, false, NOW()),

(9, 2, 'Proceso de Decoloración',
'**Aplicación:**
1. Iniciar en largos y puntas
2. Dejar raíz para el final
3. Revisar cada 10 minutos
4. Tiempo máximo: 50 minutos

**Fondos de Aclaración:**
- Nivel 1-4: Rojo
- Nivel 5-6: Naranja
- Nivel 7-8: Amarillo
- Nivel 9-10: Amarillo muy pálido',
'https://www.youtube.com/embed/dQw4w9WgXcQ', 4, 30, false, NOW()),

(10, 2, 'Cobertura de Canas',
'**Hasta 30% de canas:**
- Tinte permanente
- Oxidante 20 volúmenes

**Más de 50%:**
- Pre-pigmentación obligatoria
- Fórmula: 50% base natural + 50% reflejo',
'https://www.youtube.com/embed/dQw4w9WgXcQ', 5, 20, false, NOW());

-- 5. LECCIONES - MÓDULO 3: NIVELACIÓN
INSERT INTO academy_lessons (id, module_id, title, content, video_url, position, duration_minutes, is_free, created_at)
VALUES
(11, 3, 'El Círculo Cromático Aplicado',
'**Neutralización:**
- Azul ↔ Naranja
- Violeta ↔ Amarillo
- Verde ↔ Rojo

**Matizar Rubios:**
- Cabello amarillo (nivel 8-9): Violeta
- Cabello naranja (nivel 6-7): Azul',
'https://www.youtube.com/embed/dQw4w9WgXcQ', 1, 25, false, NOW()),

(12, 3, 'Corrección de Color',
'**Caso: Cabello Naranja**
Solución: Aplicar toner con base azul/ceniza

**Caso: Verde en Rubio**
Solución: Aplicar tinte rojo/cobre suave

**Regla de Oro:** Siempre es más fácil oscurecer que aclarar.',
'https://www.youtube.com/embed/dQw4w9WgXcQ', 2, 30, false, NOW()),

(13, 3, 'Técnicas de Matización',
'**Matizadores Comunes:**

**Violeta:** Para rubios nivel 9-10
**Azul:** Para rubios nivel 7-8
**Rosa/Perla:** Para rubios muy claros

**Proceso:**
1. Decolorar a nivel deseado
2. Mezclar matizador + oxidante 10 vol
3. Dejar 10-20 minutos',
'https://www.youtube.com/embed/dQw4w9WgXcQ', 3, 20, false, NOW()),

(14, 3, 'Formulación de Colores',
'**Ejemplo: De Castaño a Rubio Cenizo**
- Base: Castaño 5
- Objetivo: Rubio cenizo 8.1
- Proceso: Decolorar a nivel 8-9, matizar con 8.1 + 8.2',
'https://www.youtube.com/embed/dQw4w9WgXcQ', 4, 25, false, NOW());

-- 6. LECCIONES - MÓDULO 4: AVANZADAS
INSERT INTO academy_lessons (id, module_id, title, content, video_url, position, duration_minutes, is_free, created_at)
VALUES
(15, 4, 'Técnicas de Mechas',
'**Tipos:**
1. Tradicionales (Gorro)
2. Con Papel Aluminio
3. Babylights (finas)
4. Balayage (libre)',
'https://www.youtube.com/embed/dQw4w9WgXcQ', 1, 35, false, NOW()),

(16, 4, 'Balayage y Ombre',
'**Balayage:**
- Aplicación libre
- Degradado natural
- Bajo mantenimiento

**Ombre:**
- Contraste más marcado
- Degradado de oscuro a claro',
'https://www.youtube.com/embed/dQw4w9WgXcQ', 2, 30, false, NOW()),

(17, 4, 'Hair Contouring',
'**Rostro Redondo:** Mechas verticales
**Rostro Cuadrado:** Mechas alrededor del rostro
**Rostro Ovalado:** Cualquier estilo
**Rostro Alargado:** Volumen lateral',
'https://www.youtube.com/embed/dQw4w9WgXcQ', 3, 25, false, NOW()),

(18, 4, 'Tendencias 2024',
'**Tendencias:**
1. Money Piece
2. Bronde
3. Cinnamon Copper
4. Ash Blonde
5. Rose Gold',
'https://www.youtube.com/embed/dQw4w9WgXcQ', 4, 20, false, NOW()),

(19, 4, 'Cuidado Post-Coloración',
'**Recomendaciones:**
- Shampoo sin sulfatos
- Lavar con agua tibia/fría
- Espaciar lavados (2-3 veces/semana)
- Mascarillas semanales
- Retoque raíz: Cada 4-6 semanas',
'https://www.youtube.com/embed/dQw4w9WgXcQ', 5, 15, false, NOW());

-- 7. QUIZZES
INSERT INTO academy_quizzes (id, lesson_id, question, options, correct_answer, created_at)
VALUES
(1, 1, '¿Cuál es el pigmento responsable de los colores oscuros?', '["Eumelanina", "Feomelanina", "Queratina", "Colágeno"]', 0, NOW()),
(2, 1, '¿Cuál es el principal componente del cabello?', '["Agua", "Queratina", "Melanina", "Lípidos"]', 1, NOW()),
(3, 3, '¿Cuáles son los colores primarios?', '["Rojo, Verde, Azul", "Naranja, Violeta, Verde", "Azul, Rojo, Amarillo", "Negro, Blanco, Gris"]', 2, NOW()),
(4, 4, '¿Qué altura de tono es rubio medio?', '["5", "6", "7", "8"]', 2, NOW()),
(5, 5, '¿Qué fondo aparece en nivel 7?', '["Rojo", "Naranja", "Amarillo", "Amarillo pálido"]', 2, NOW()),
(6, 6, '¿Qué volumen se usa para canas?', '["10 vol", "20 vol", "30 vol", "40 vol"]', 1, NOW()),
(7, 9, '¿Tiempo máximo de decoloración?', '["20 min", "30 min", "50 min", "90 min"]', 2, NOW()),
(8, 11, '¿Qué color neutraliza el amarillo?', '["Azul", "Violeta", "Verde", "Naranja"]', 1, NOW()),
(9, 15, '¿Qué técnica usa gorro?', '["Balayage", "Mechas tradicionales", "Babylights", "Ombre"]', 1, NOW()),
(10, 19, '¿Cada cuánto retocar raíz?', '["1 semana", "4-6 semanas", "3 meses", "6 meses"]', 1, NOW());

-- Actualizar secuencias
SELECT setval('academy_courses_id_seq', COALESCE((SELECT MAX(id)+1 FROM academy_courses), 1), false);
SELECT setval('academy_modules_id_seq', COALESCE((SELECT MAX(id)+1 FROM academy_modules), 1), false);
SELECT setval('academy_lessons_id_seq', COALESCE((SELECT MAX(id)+1 FROM academy_lessons), 1), false);
SELECT setval('academy_quizzes_id_seq', COALESCE((SELECT MAX(id)+1 FROM academy_quizzes), 1), false);

-- 1. Usuarios base (las contraseñas se generan dinámicamente en runtime mediante SEED_PASSWORD)
INSERT INTO usuarios (id, email, password_hash, nombre, phone, auth_provider, provider_id, rol, onboarding_completo) VALUES
(1, 'admin@beautyapp.com', '__SEED_PASSWORD_HASH__', 'Admin System', '+573000000000', 'LOCAL', 'admin-local', 'ADMIN', true),
(2, 'maria@correo.com', '__SEED_PASSWORD_HASH__', 'María López', '+573001112222', 'LOCAL', 'maria-local', 'PRESTADOR', true),
(3, 'carlos@correo.com', '__SEED_PASSWORD_HASH__', 'Carlos Ruiz', '+573003334444', 'LOCAL', 'carlos-local', 'PRESTADOR', true),
(4, 'ana@cliente.com', '__SEED_PASSWORD_HASH__', 'Ana Gómez', '+573005556666', 'LOCAL', 'ana-local', 'CLIENTE', true),
(5, 'provider@beautyapp.com', '__SEED_PASSWORD_HASH__', 'Ana Silva Estilista', '+573159876543', 'LOCAL', 'local_provider@beautyapp.com', 'PRESTADOR', true),
(6, 'miusuario@correo.com', '__SEED_PASSWORD_HASH__', 'Cliente de Prueba', '+573000000001', 'LOCAL', 'local_miusuario@correo.com', 'CLIENTE', true),
(7, 'salon@beautyapp.com', '__SEED_PASSWORD_HASH__', 'Dueño Salón Luxe', '+573009998877', 'LOCAL', 'local_salon@beautyapp.com', 'SALON', true)
ON CONFLICT (id) DO NOTHING;

-- Ajustar la secuencia del serial tras las inserciones manuales de ID
SELECT setval('usuarios_id_seq', 7);

-- 2. Perfiles de prestadores (con coordenadas geoespaciales en Fontibón, Bogotá y estado APROBADO)
INSERT INTO perfiles_prestador (id, business_name, description, is_online, estatus_verificacion, ubicacion, metodo_retiro, numero_cuenta_nequi, documento_titular, rating_avg, rating_count, is_active) VALUES
(2, 'Studio María Hair', 'Especialista en balayage y cortes modernos', true, 'APROBADO', ST_SetSRID(ST_MakePoint(-74.0817, 4.6097), 4326), 'NEQUI', '+573001112222', '1018222333', 4.8, 1, true),
(3, 'Carlos Nails & Spa', 'Manicura semipermanente y nail art', false, 'APROBADO', ST_SetSRID(ST_MakePoint(-74.1422, 4.6735), 4326), 'NEQUI', '+573003334444', '1019444555', 4.0, 0, true),
(5, 'Ana Silva Premium Beauty', 'Estilista profesional certificada con más de 8 años de experiencia en colorimetría, cortes de vanguardia, maquillaje de gala y diseño de cejas. Servicio personalizado a domicilio en Fontibón.', true, 'APROBADO', ST_SetSRID(ST_MakePoint(-74.1385, 4.6720), 4326), 'NEQUI', '+573159876543', '1020444555', 4.9, 2, true)
ON CONFLICT (id) DO NOTHING;

-- 3. Servicios para prestadores
-- Servicios de María López (id=2)
INSERT INTO services (id, provider_id, name, description, price, duration_minutes, category, is_active) VALUES
('a0000000-0000-0000-0000-000000000002', 2, 'Corte + Lavado', 'Incluye diagnóstico capilar', 35000.00, 45, 'hair', true),
('a0000000-0000-0000-0000-000000000102', 2, 'Balayage Completo', 'Técnica de iluminación personalizada', 120000.00, 150, 'hair', true)
ON CONFLICT (id) DO NOTHING;

-- Servicios de Carlos Ruiz (id=3)
INSERT INTO services (id, provider_id, name, description, price, duration_minutes, category, is_active) VALUES
('a0000000-0000-0000-0000-000000000003', 3, 'Manicura Semipermanente', 'Limpieza, limado y esmaltado duradero', 25000.00, 60, 'nails', true)
ON CONFLICT (id) DO NOTHING;

-- Servicios de Ana Silva (id=5)
INSERT INTO services (id, provider_id, name, description, price, duration_minutes, category, is_active) VALUES
('a0000000-0000-0000-0000-000000000005', 5, 'Corte de Cabello Premium + Peinado', 'Corte personalizado adaptado a tu rostro, lavado orgánico con masaje capilar y cepillado estilizado profesional.', 45000.00, 60, 'hair', true),
('a0000000-0000-0000-0000-000000000105', 5, 'Maquillaje Profesional de Noche', 'Maquillaje glam de alta duración para eventos, incluye preparación e hidratación de piel y pestañas por punto.', 80000.00, 90, 'makeup', true),
('a0000000-0000-0000-0000-000000000205', 5, 'Manicura + Pedicura Spa', 'Limpieza profunda, exfoliación de sales minerales, esmaltado semipermanente de larga duración y diseños minimalistas a elección.', 50000.00, 80, 'nails', true)
ON CONFLICT (id) DO NOTHING;

-- 4. Portafolio de Trabajos (Books de Fotos con Unsplash de alta resolución)
INSERT INTO portfolio_items (id, provider_id, image_url, title, category, likes_count) VALUES
('f0000000-0000-0000-0000-000000000001', 5, 'https://images.unsplash.com/photo-1562322140-8baeececf3df?q=80&w=600&auto=format&fit=crop', 'Rubio Balayage Cenizo', 'hair', 15),
('f0000000-0000-0000-0000-000000000002', 5, 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?q=80&w=600&auto=format&fit=crop', 'Maquillaje Glam Noche', 'makeup', 28),
('f0000000-0000-0000-0000-000000000003', 5, 'https://images.unsplash.com/photo-1604654894610-df49068853b0?q=80&w=600&auto=format&fit=crop', 'Uñas Semipermanentes Pastel', 'nails', 12)
ON CONFLICT (id) DO NOTHING;

-- 5. Citas de prueba para historial y reseñas
-- Cita vieja de María López
INSERT INTO bookings (id, client_id, provider_id, service_id, scheduled_at, valor_bruto, estado, pin_verificacion) VALUES
('b0000000-0000-0000-0000-000000000002', 4, 2, 'a0000000-0000-0000-0000-000000000002', '2026-05-25 15:00:00+00', 35000.00, 'COMPLETADA', '4821')
ON CONFLICT (id) DO NOTHING;

-- Citas de Ana Silva (Para construir el historial y promedio de valoración)
INSERT INTO bookings (id, client_id, provider_id, service_id, scheduled_at, valor_bruto, estado, pin_verificacion) VALUES
('b0000000-0000-0000-0000-000000000005', 4, 5, 'a0000000-0000-0000-0000-000000000005', '2026-05-20 10:00:00+00', 45000.00, 'COMPLETADA', '1122'),
('b0000000-0000-0000-0000-000000000105', 6, 5, 'a0000000-0000-0000-0000-000000000105', '2026-05-22 18:00:00+00', 80000.00, 'COMPLETADA', '3344')
ON CONFLICT (id) DO NOTHING;

-- 6. Reseñas históricas
INSERT INTO reviews (id, booking_id, client_id, provider_id, rating, comment) VALUES
('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 4, 2, 5, 'Muy puntual y el corte excelente.'),
('c0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000005', 4, 5, 5, '¡Ana es maravillosa! Hizo un trabajo increíble con mi cabello, súper recomendada.'),
('c0000000-0000-0000-0000-000000000105', 'b0000000-0000-0000-0000-000000000105', 6, 5, 5, 'El maquillaje duró toda la noche y captó exactamente lo que quería. Volveré a reservar.')
ON CONFLICT (id) DO NOTHING;
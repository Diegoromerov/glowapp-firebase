-- ================================================================
-- BELLEZA APP — SEED COMPLETO RAILWAY
-- ================================================================

BEGIN;

-- SEGURIDAD: la columna password_hash NO debe versionarse con hashes reales.
-- Cada fila de usuarios usa el marcador __SEED_PASSWORD_HASH__, que backend/src/utils/seedRunner.js
-- reemplaza en runtime por bcrypt(SEED_PASSWORD). Sin SEED_PASSWORD la siembra falla cerrada.
-- Ver backend/seed.sql (misma convencion) y backend/src/tests/seedRunner.test.js.
-- USUARIOS
INSERT INTO usuarios (id, email, password_hash, nombre, phone, auth_provider, provider_id, rol, onboarding_completo) VALUES
(101,'carolina.hair@bellezaapp.com','__SEED_PASSWORD_HASH__','Carolina Mendoza Rios','+573124567890','LOCAL','local_carolina','PRESTADOR',true),
(102,'santiago.barber@bellezaapp.com','__SEED_PASSWORD_HASH__','Santiago Castro Devia','+573157890123','LOCAL','local_santiago','PRESTADOR',true),
(103,'valeria.makeup@bellezaapp.com','__SEED_PASSWORD_HASH__','Valeria Sofia Tobon','+573203456789','LOCAL','local_valeria','PRESTADOR',true),
(104,'prov_nails_001@bellezaapp.com','__SEED_PASSWORD_HASH__','Ana Silva Torres','+573159876543','LOCAL','local_ana_silva','PRESTADOR',true),
(105,'diana.facials@bellezaapp.com','__SEED_PASSWORD_HASH__','Diana Marcela Gomez','+573186543210','LOCAL','local_diana','PRESTADOR',true),
(1,'cliente.demo@bellezaapp.com','__SEED_PASSWORD_HASH__','Cliente Demo','+573100000001','LOCAL','local_cliente_demo','CLIENTE',true),
(200,'salon@beautyapp.com','__SEED_PASSWORD_HASH__','Dueño Salón Luxe Suite','+573009998877','LOCAL','local_salon_demo','SALON',true)
ON CONFLICT (id) DO UPDATE SET nombre=EXCLUDED.nombre, phone=EXCLUDED.phone;

-- FOTOS DE PERFIL
UPDATE usuarios SET foto_url='https://images.unsplash.com/photo-1494790108377-be9c29b29330?q=80&w=200&auto=format&fit=crop' WHERE id=101;
UPDATE usuarios SET foto_url='https://images.unsplash.com/photo-1500648767791-00dcc994a43e?q=80&w=200&auto=format&fit=crop' WHERE id=102;
UPDATE usuarios SET foto_url='https://images.unsplash.com/photo-1438761681033-6461ffad8d80?q=80&w=200&auto=format&fit=crop' WHERE id=103;
UPDATE usuarios SET foto_url='https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=200&auto=format&fit=crop' WHERE id=104;
UPDATE usuarios SET foto_url='https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=200&auto=format&fit=crop' WHERE id=105;

-- PERFILES PRESTADOR
INSERT INTO perfiles_prestador (id,business_name,description,is_online,estatus_verificacion,ubicacion,metodo_retiro,numero_cuenta_nequi,documento_titular,rating_avg,rating_count,is_active) VALUES
(101,'Carolina Hair Studio','Especialista en Balayage y Colorimetria Avanzada',true,'APROBADO',ST_SetSRID(ST_MakePoint(-74.1420,4.6730),4326),'NEQUI','+573124567890','1018333222',4.8,10,true),
(102,'Santiago Barber Shop','Barberia clasica y corte masculino moderno',true,'APROBADO',ST_SetSRID(ST_MakePoint(-74.1360,4.6750),4326),'NEQUI','+573157890123','1019444333',4.7,8,true),
(103,'Valeria Tobon Makeup','Maquillaje profesional para eventos y novias',true,'APROBADO',ST_SetSRID(ST_MakePoint(-74.1460,4.6710),4326),'NEQUI','+573203456789','1020555444',4.9,15,true),
(104,'Ana Silva Nail Art','Manicura semipermanente y extensiones de unas',true,'APROBADO',ST_SetSRID(ST_MakePoint(-74.1385,4.6720),4326),'NEQUI','+573159876543','1021666555',4.6,6,true),
(105,'Diana Gomez Estetica','Tratamientos faciales, hidratacion y limpieza profunda',true,'APROBADO',ST_SetSRID(ST_MakePoint(-74.1310,4.6780),4326),'NEQUI','+573186543210','1022777666',4.9,12,true)
ON CONFLICT (id) DO UPDATE SET business_name=EXCLUDED.business_name,description=EXCLUDED.description,estatus_verificacion=EXCLUDED.estatus_verificacion,is_active=EXCLUDED.is_active;

-- SERVICIOS
INSERT INTO services (id,provider_id,name,description,price,duration_minutes,category,is_active) VALUES
('00000000-0000-0000-0000-000000000101',101,'Balayage Cenizo + Hidratacion Plex','Tecnica de iluminacion capilar ceniza con cuidado protector.',320000.00,180,'hair',true),
('00000000-0000-0000-0000-000000000102',101,'Corte Tendencia + Cepillado','Corte moderno personalizado.',65000.00,60,'hair',true),
('00000000-0000-0000-0000-000000000201',102,'Corte Premium + Perfilado de Barba','Corte y afeitado tradicional.',45000.00,50,'hair',true),
('00000000-0000-0000-0000-000000000202',102,'Camuflaje de Canas Masculino','Servicio rapido de cobertura de canas.',50000.00,40,'hair',true),
('00000000-0000-0000-0000-000000000301',103,'Maquillaje Social Premium','Maquillaje elegante de larga duracion.',140000.00,75,'makeup',true),
('00000000-0000-0000-0000-000000000302',103,'Maquillaje de Novia (Con Prueba)','Maquillaje especial y prueba de estilo.',280000.00,120,'makeup',true),
('00000000-0000-0000-0000-000000000401',104,'Manicura Tradicional Express','Cuidado de unas express.',28000.00,40,'nails',true),
('00000000-0000-0000-0000-000000000402',104,'Manicura Semipermanente Profesional','Durabilidad garantizada con esmaltado semipermanente.',55000.00,60,'nails',true),
('00000000-0000-0000-0000-000000000403',104,'Manicura + Pedicura Spa Combo','Combo completo spa manos y pies.',85000.00,90,'nails',true),
('00000000-0000-0000-0000-000000000404',104,'Extension de Unas en Gel-X','Extensiones de unas elegantes.',120000.00,100,'nails',true),
('00000000-0000-0000-0000-000000000405',104,'Kapping Base Ruber','Recubrimiento fortalecedor.',75000.00,75,'nails',true),
('00000000-0000-0000-0000-000000000501',105,'Limpieza Facial Profunda','Limpieza profunda de impurezas.',95000.00,75,'facials',true),
('00000000-0000-0000-0000-000000000502',105,'Hidratacion Acido Hialuronico','Tratamiento facial hidratante intensivo.',120000.00,60,'facials',true)
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,price=EXCLUDED.price,is_active=EXCLUDED.is_active;

-- PORTAFOLIO
DELETE FROM portfolio_items WHERE provider_id IN (101,102,103,104,105);

INSERT INTO portfolio_items (id,provider_id,image_url,title,category) VALUES
('e1010000-0000-0000-0000-000000000001',101,'https://images.unsplash.com/photo-1562322140-8baeececf3df?q=80&w=800','Balayage Cenizo Premium','hair'),
('e1010000-0000-0000-0000-000000000002',101,'https://images.unsplash.com/photo-1492106087820-71f1a00d2b11?q=80&w=800','Cabello Iluminado Ondas','hair'),
('e1010000-0000-0000-0000-000000000003',101,'https://images.unsplash.com/photo-1522337360788-8b13df793f1f?q=80&w=800','Corte Bob Estilizado','hair'),
('e1010000-0000-0000-0000-000000000004',101,'https://images.unsplash.com/photo-1595425970377-c9703cf48b6d?q=80&w=800','Diseno de Color Fantasia','hair'),
('e1020000-0000-0000-0000-000000000001',102,'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?q=80&w=800','Mid Fade Clasico','hair'),
('e1020000-0000-0000-0000-000000000002',102,'https://images.unsplash.com/photo-1621605815971-fbc98d665033?q=80&w=800','Afeitado y Toalla Caliente','hair'),
('e1020000-0000-0000-0000-000000000003',102,'https://images.unsplash.com/photo-1622286342621-4bd786c2447c?q=80&w=800','Pompadour + Perfilado','hair'),
('e1020000-0000-0000-0000-000000000004',102,'https://images.unsplash.com/photo-1593702295094-aec22597af65?q=80&w=800','Degradado Barba Disenada','hair'),
('e1030000-0000-0000-0000-000000000001',103,'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?q=80&w=800','Maquillaje de Ojos Smokey','makeup'),
('e1030000-0000-0000-0000-000000000002',103,'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?q=80&w=800','Maquillaje Novia Natural','makeup'),
('e1030000-0000-0000-0000-000000000003',103,'https://images.unsplash.com/photo-1512496015851-a90fb38ba796?q=80&w=800','Maquillaje Glam de Gala','makeup'),
('e1030000-0000-0000-0000-000000000004',103,'https://images.unsplash.com/photo-1526045478516-99145907023c?q=80&w=800','Maquillaje Editorial Color','makeup'),
('e1040000-0000-0000-0000-000000000001',104,'https://images.unsplash.com/photo-1604654894610-df63bc536371?q=80&w=800','Manicura Semipermanente Roja','nails'),
('e1040000-0000-0000-0000-000000000002',104,'https://images.unsplash.com/photo-1629732047847-50b7ef46c3bb?q=80&w=800','Diseno Frances Clasico','nails'),
('e1040000-0000-0000-0000-000000000003',104,'https://images.unsplash.com/photo-1607779097040-26e80aa78e66?q=80&w=800','Unas Nude Minimalistas','nails'),
('e1040000-0000-0000-0000-000000000004',104,'https://images.unsplash.com/photo-1632345031435-8797b2d58045?q=80&w=800','Gel-X Brillo Escarcha','nails'),
('e1050000-0000-0000-0000-000000000001',105,'https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?q=80&w=800','Limpieza Facial Exfoliante','facials'),
('e1050000-0000-0000-0000-000000000002',105,'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?q=80&w=800','Aplicacion Mascarilla de Arcilla','facials'),
('e1050000-0000-0000-0000-000000000003',105,'https://images.unsplash.com/photo-1515377905703-c4788e51af15?q=80&w=800','Masaje Facial Relajante','facials'),
('e1050000-0000-0000-0000-000000000004',105,'https://images.unsplash.com/photo-1616394584738-fc6e612e71b9?q=80&w=800','Piel Radiante Post Tratamiento','facials')
ON CONFLICT (id) DO NOTHING;

-- BOOKINGS (citas completadas)
INSERT INTO bookings (id,client_id,provider_id,service_id,scheduled_at,valor_bruto,estado,pin_verificacion,payment_status) VALUES
('b0000000-0000-0000-0000-000000000101',1,101,'00000000-0000-0000-0000-000000000101',NOW()-INTERVAL '5 days',320000.00,'COMPLETADA','1111','paid'),
('b0000000-0000-0000-0000-000000000102',1,101,'00000000-0000-0000-0000-000000000102',NOW()-INTERVAL '4 days',65000.00,'COMPLETADA','2222','paid'),
('b0000000-0000-0000-0000-000000000201',1,102,'00000000-0000-0000-0000-000000000201',NOW()-INTERVAL '5 days',45000.00,'COMPLETADA','3333','paid'),
('b0000000-0000-0000-0000-000000000202',1,102,'00000000-0000-0000-0000-000000000202',NOW()-INTERVAL '4 days',50000.00,'COMPLETADA','4444','paid'),
('b0000000-0000-0000-0000-000000000301',1,103,'00000000-0000-0000-0000-000000000301',NOW()-INTERVAL '5 days',140000.00,'COMPLETADA','5555','paid'),
('b0000000-0000-0000-0000-000000000302',1,103,'00000000-0000-0000-0000-000000000302',NOW()-INTERVAL '4 days',280000.00,'COMPLETADA','6666','paid'),
('b0000000-0000-0000-0000-000000000401',1,104,'00000000-0000-0000-0000-000000000402',NOW()-INTERVAL '5 days',55000.00,'COMPLETADA','7777','paid'),
('b0000000-0000-0000-0000-000000000402',1,104,'00000000-0000-0000-0000-000000000404',NOW()-INTERVAL '4 days',120000.00,'COMPLETADA','8888','paid'),
('b0000000-0000-0000-0000-000000000501',1,105,'00000000-0000-0000-0000-000000000501',NOW()-INTERVAL '5 days',95000.00,'COMPLETADA','9999','paid'),
('b0000000-0000-0000-0000-000000000502',1,105,'00000000-0000-0000-0000-000000000502',NOW()-INTERVAL '4 days',120000.00,'COMPLETADA','0000','paid')
ON CONFLICT (id) DO NOTHING;

-- REVIEWS
INSERT INTO reviews (booking_id,client_id,provider_id,rating,comment) VALUES
('b0000000-0000-0000-0000-000000000101',1,101,5,'El balayage me quedo increible! Super profesional y el cabello se siente muy hidratado.'),
('b0000000-0000-0000-0000-000000000102',1,101,5,'Me encanto el corte tendencia. Carolina entendio perfectamente lo que queria.'),
('b0000000-0000-0000-0000-000000000201',1,102,5,'Excelente perfilado de barba y el trato premium fue inmejorable.'),
('b0000000-0000-0000-0000-000000000202',1,102,4,'Muy buen trabajo disimulando las canas de forma natural. Rapido y limpio.'),
('b0000000-0000-0000-0000-000000000301',1,103,5,'El maquillaje social me duro toda la noche intacto. Excelente tecnica!'),
('b0000000-0000-0000-0000-000000000302',1,103,5,'La prueba de maquillaje de novia fue perfecta. Valeria es muy atenta y dulce.'),
('b0000000-0000-0000-0000-000000000401',1,104,4,'Muy buen servicio de semipermanente, amplio catalogo de colores.'),
('b0000000-0000-0000-0000-000000000402',1,104,5,'Las extensiones de Gel-X quedaron super naturales y muy resistentes.'),
('b0000000-0000-0000-0000-000000000501',1,105,5,'La limpieza facial profunda fue un spa completo. La piel me quedo hermosa y limpia.'),
('b0000000-0000-0000-0000-000000000502',1,105,5,'Increible hidratacion con acido hialuronico, muy recomendado el servicio a domicilio.')
ON CONFLICT (booking_id) DO NOTHING;

-- ACTUALIZAR RATINGS
UPDATE perfiles_prestador SET rating_avg=(SELECT AVG(rating) FROM reviews WHERE provider_id=101),rating_count=(SELECT COUNT(*) FROM reviews WHERE provider_id=101) WHERE id=101;
UPDATE perfiles_prestador SET rating_avg=(SELECT AVG(rating) FROM reviews WHERE provider_id=102),rating_count=(SELECT COUNT(*) FROM reviews WHERE provider_id=102) WHERE id=102;
UPDATE perfiles_prestador SET rating_avg=(SELECT AVG(rating) FROM reviews WHERE provider_id=103),rating_count=(SELECT COUNT(*) FROM reviews WHERE provider_id=103) WHERE id=103;
UPDATE perfiles_prestador SET rating_avg=(SELECT AVG(rating) FROM reviews WHERE provider_id=104),rating_count=(SELECT COUNT(*) FROM reviews WHERE provider_id=104) WHERE id=104;
UPDATE perfiles_prestador SET rating_avg=(SELECT AVG(rating) FROM reviews WHERE provider_id=105),rating_count=(SELECT COUNT(*) FROM reviews WHERE provider_id=105) WHERE id=105;

-- HORARIOS
UPDATE perfiles_prestador SET active_start_hour=8,active_end_hour=17,weekly_schedule='{"lunes":{"activo":true,"inicio":8,"fin":17},"martes":{"activo":true,"inicio":8,"fin":17},"miercoles":{"activo":true,"inicio":8,"fin":17},"jueves":{"activo":true,"inicio":8,"fin":17},"viernes":{"activo":true,"inicio":8,"fin":17},"sabado":{"activo":true,"inicio":8,"fin":14},"domingo":{"activo":false,"inicio":0,"fin":0}}'::jsonb WHERE id=101;
UPDATE perfiles_prestador SET active_start_hour=10,active_end_hour=19,weekly_schedule='{"lunes":{"activo":true,"inicio":10,"fin":19},"martes":{"activo":true,"inicio":10,"fin":19},"miercoles":{"activo":true,"inicio":10,"fin":19},"jueves":{"activo":true,"inicio":10,"fin":19},"viernes":{"activo":true,"inicio":10,"fin":19},"sabado":{"activo":true,"inicio":10,"fin":19},"domingo":{"activo":true,"inicio":10,"fin":16}}'::jsonb WHERE id=102;
UPDATE perfiles_prestador SET active_start_hour=7,active_end_hour=15,weekly_schedule='{"lunes":{"activo":false,"inicio":0,"fin":0},"martes":{"activo":true,"inicio":7,"fin":15},"miercoles":{"activo":true,"inicio":7,"fin":15},"jueves":{"activo":true,"inicio":7,"fin":15},"viernes":{"activo":true,"inicio":7,"fin":15},"sabado":{"activo":true,"inicio":7,"fin":15},"domingo":{"activo":false,"inicio":0,"fin":0}}'::jsonb WHERE id=103;
UPDATE perfiles_prestador SET active_start_hour=11,active_end_hour=20,weekly_schedule='{"lunes":{"activo":true,"inicio":11,"fin":20},"martes":{"activo":true,"inicio":11,"fin":20},"miercoles":{"activo":true,"inicio":11,"fin":20},"jueves":{"activo":true,"inicio":11,"fin":20},"viernes":{"activo":true,"inicio":11,"fin":20},"sabado":{"activo":true,"inicio":9,"fin":17},"domingo":{"activo":false,"inicio":0,"fin":0}}'::jsonb WHERE id=104;
UPDATE perfiles_prestador SET active_start_hour=8,active_end_hour=16,weekly_schedule='{"lunes":{"activo":true,"inicio":8,"fin":16},"martes":{"activo":true,"inicio":8,"fin":16},"miercoles":{"activo":true,"inicio":8,"fin":16},"jueves":{"activo":true,"inicio":8,"fin":16},"viernes":{"activo":true,"inicio":8,"fin":16},"sabado":{"activo":true,"inicio":8,"fin":14},"domingo":{"activo":false,"inicio":0,"fin":0}}'::jsonb WHERE id=105;

-- VERIFICACION FINAL
SELECT 'usuarios' AS tabla,COUNT(*) AS ok FROM usuarios WHERE id IN (101,102,103,104,105)
UNION ALL SELECT 'perfiles',COUNT(*) FROM perfiles_prestador WHERE id IN (101,102,103,104,105)
UNION ALL SELECT 'services',COUNT(*) FROM services WHERE provider_id IN (101,102,103,104,105)
UNION ALL SELECT 'portfolio',COUNT(*) FROM portfolio_items WHERE provider_id IN (101,102,103,104,105)
UNION ALL SELECT 'bookings',COUNT(*) FROM bookings WHERE provider_id IN (101,102,103,104,105)
UNION ALL SELECT 'reviews',COUNT(*) FROM reviews WHERE provider_id IN (101,102,103,104,105);

COMMIT;

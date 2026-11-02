-- ============================================================
-- SEED: 11 prestadores de demostración para preproducción
--
-- Qué hace: deja el mapa y los flujos de reserva con datos utilizables.
-- Los perfiles 9, 106 y 1001 existen en producción en estado PENDIENTE o sin
-- ubicación: aquí se habilitan con nombre, negocio, coordenadas, horario,
-- catálogo y foto.
--
-- Idempotente: se puede correr las veces que haga falta. No borra nada —
-- los servicios se insertan solo si no existen por (provider_id, name), así
-- que nunca rompe reservas históricas que los referencien.
--
-- Ejecutar:
--   psql "$DATABASE_URL" -f backend/seed/prestadores-demo-11.sql
--   railway ssh -s belleza-app -- node -   (ver README de seeds)
--
-- ⚠️  Datos ficticios de preproducción. Los perfiles 9, 106 y 1001 quedan
--     APROBADOS y por tanto visibles en el mapa público: no ejecutar en
--     producción sin una decisión explícita del Director.
--
-- Sin contraseñas: los usuarios se crean sin password_hash, así que no
-- permiten iniciar sesión. Es deliberado (la convención del repo prohíbe
-- hashes versionados); para poder entrar, definir la contraseña aparte.
-- ============================================================

BEGIN;

-- ─── 0. Columnas que la aplicación crea en caliente ───────────────────────
-- `index.js` añade estas columnas en cada arranque ("Alteración usuarios /
-- perfiles_prestador: columna asegurada"). Una base recién migrada, que nunca
-- ha arrancado la app, no las tiene: sin esto el seed falla.
ALTER TABLE usuarios            ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE perfiles_prestador  ADD COLUMN IF NOT EXISTS weekly_schedule JSONB;
ALTER TABLE perfiles_prestador  ADD COLUMN IF NOT EXISTS active_start_hour INTEGER DEFAULT 9;
ALTER TABLE perfiles_prestador  ADD COLUMN IF NOT EXISTS active_end_hour INTEGER DEFAULT 19;

-- ─── 1. Usuarios de los prestadores ────────────────────────────────────────
INSERT INTO usuarios (id, email, nombre, auth_provider, provider_id, responsable_iva,
                      tarifa_iva, rol, tenant_id, onboarding_completo, is_active, foto_url)
VALUES
  (2,    'prov2@test.co',    'María López',           'LOCAL', 'prov-2',    false, 0, 'PRESTADOR', 1, true, true,
   'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=300&h=300&fit=crop&crop=faces&auto=format'),
  (3,    'prov3@test.co',    'Carlos Ruiz',           'LOCAL', 'prov-3',    false, 0, 'PRESTADOR', 1, true, true,
   'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=300&h=300&fit=crop&crop=faces&auto=format'),
  (5,    'prov5@test.co',    'Ana Silva Estilista',   'LOCAL', 'prov-5',    false, 0, 'PRESTADOR', 1, true, true,
   'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300&h=300&fit=crop&crop=faces&auto=format'),
  (9,    'prov9@test.co',    'Lorena Pardo',          'LOCAL', 'prov-9',    false, 0, 'PRESTADOR', 1, true, true,
   'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=300&h=300&fit=crop&crop=faces&auto=format'),
  (101,  'prov101@test.co',  'Carolina Mendoza Rios', 'LOCAL', 'prov-101',  false, 0, 'PRESTADOR', 1, true, true,
   'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=300&h=300&fit=crop&crop=faces&auto=format'),
  (102,  'prov102@test.co',  'Santiago Castro Devia', 'LOCAL', 'prov-102',  false, 0, 'PRESTADOR', 1, true, true,
   'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&h=300&fit=crop&crop=faces&auto=format'),
  (103,  'prov103@test.co',  'Valeria Sofia Tobon',   'LOCAL', 'prov-103',  false, 0, 'PRESTADOR', 1, true, true,
   'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=300&h=300&fit=crop&crop=faces&auto=format'),
  (104,  'prov104@test.co',  'Ana Silva Torres',      'LOCAL', 'prov-104',  false, 0, 'PRESTADOR', 1, true, true,
   'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=300&h=300&fit=crop&crop=faces&auto=format'),
  (105,  'prov105@test.co',  'Diana Marcela Gomez',   'LOCAL', 'prov-105',  false, 0, 'PRESTADOR', 1, true, true,
   'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=300&h=300&fit=crop&crop=faces&auto=format'),
  (106,  'prov106@test.co',  'Sonia Herrera',         'LOCAL', 'prov-106',  false, 0, 'PRESTADOR', 1, true, true,
   'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=300&h=300&fit=crop&crop=faces&auto=format'),
  (1001, 'prov1001@test.co', 'Adrián Romero',         'LOCAL', 'prov-1001', false, 0, 'PRESTADOR', 1, true, true,
   'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=300&h=300&fit=crop&crop=faces&auto=format')
ON CONFLICT (id) DO UPDATE
  SET nombre               = EXCLUDED.nombre,
      foto_url             = EXCLUDED.foto_url,
      rol                  = 'PRESTADOR',
      tenant_id            = 1,
      onboarding_completo  = true,
      is_active            = true;

-- ─── 2. Perfiles: ubicación, estado aprobado y horario ─────────────────────
INSERT INTO perfiles_prestador (id, business_name, description, estatus_verificacion,
                                is_active, rating_avg, rating_count, ubicacion,
                                cancelaciones_tardias, tenant_id, weekly_schedule,
                                active_start_hour, active_end_hour)
VALUES
  (2,    'Studio María Hair',        'Color y corte con enfoque en cabello con textura.',  'APROBADO', true, 4.80, 12,
   ST_SetSRID(ST_MakePoint(-74.14021856753826, 4.667982009477405), 4326)::geography, 0, 1, NULL, 9, 19),
  (3,    'Carlos Nails & Spa',       'Manicura, pedicura y cuidado de uñas.',             'APROBADO', true, 4.00,  8,
   ST_SetSRID(ST_MakePoint(-74.1422, 4.6735), 4326)::geography, 0, 1, NULL, 9, 19),
  (5,    'Ana Silva Premium Beauty', 'Color avanzado, balayage y maquillaje profesional.', 'APROBADO', true, 4.90, 21,
   ST_SetSRID(ST_MakePoint(-74.14008183202674, 4.667645276329755), 4326)::geography, 0, 1, NULL, 9, 19),
  (9,    'Lorena Pardo Beauty Lab',  'Tratamientos faciales y maquillaje de día.',        'APROBADO', true, 4.70,  5,
   ST_SetSRID(ST_MakePoint(-74.1372, 4.6695), 4326)::geography, 0, 1, NULL, 9, 19),
  (101,  'Carolina Hair Studio',     'Corte, color y tratamientos capilares.',            'APROBADO', true, 5.00, 15,
   ST_SetSRID(ST_MakePoint(-74.1402660639598, 4.667776581951054), 4326)::geography, 0, 1, NULL, 9, 19),
  (102,  'Santiago Barber Shop',     'Barbería clásica: corte, barba y afeitado.',        'APROBADO', true, 4.50,  9,
   ST_SetSRID(ST_MakePoint(-74.13983628158742, 4.668112921971416), 4326)::geography, 0, 1, NULL, 9, 19),
  (103,  'Valeria Tobon Makeup',     'Maquillaje social, novias y pestañas.',             'APROBADO', true, 5.00, 17,
   ST_SetSRID(ST_MakePoint(-74.146, 4.671), 4326)::geography, 0, 1, NULL, 9, 19),
  (104,  'Ana Silva Nail Art',       'Nail art, acrílicas y semipermanente.',             'APROBADO', true, 4.50,  6,
   ST_SetSRID(ST_MakePoint(-74.1385, 4.672), 4326)::geography, 0, 1, NULL, 9, 19),
  (105,  'Diana Gomez Estetica',     'Faciales, depilación y masajes.',                   'APROBADO', true, 5.00, 11,
   ST_SetSRID(ST_MakePoint(-74.131, 4.678), 4326)::geography, 0, 1, NULL, 9, 19),
  (106,  'Sonia Herrera Beauty Spa', 'Keratina, alisados y peinados de evento.',          'APROBADO', true, 5.00,  7,
   ST_SetSRID(ST_MakePoint(-74.14, 4.674), 4326)::geography, 0, 1, NULL, 9, 19),
  (1001, 'Adrián Romero Barber Lab', 'Barbería urbana y cuidado de barba.',               'APROBADO', true, 4.60,  4,
   ST_SetSRID(ST_MakePoint(-74.1345, 4.6708), 4326)::geography, 0, 1, NULL, 9, 19)
ON CONFLICT (id) DO UPDATE
  SET business_name         = EXCLUDED.business_name,
      description           = EXCLUDED.description,
      estatus_verificacion  = 'APROBADO',
      is_active             = true,
      rating_avg            = EXCLUDED.rating_avg,
      rating_count          = EXCLUDED.rating_count,
      ubicacion             = EXCLUDED.ubicacion,
      tenant_id             = 1,
      active_start_hour     = 9,
      active_end_hour       = 19;

-- Horario: lunes a jueves 9–19, viernes 9–20, sábado 9–17, domingo cerrado.
UPDATE perfiles_prestador
   SET weekly_schedule = '{
         "lunes":{"activo":true,"inicio":9,"fin":19},
         "martes":{"activo":true,"inicio":9,"fin":19},
         "miercoles":{"activo":true,"inicio":9,"fin":19},
         "jueves":{"activo":true,"inicio":9,"fin":19},
         "viernes":{"activo":true,"inicio":9,"fin":20},
         "sabado":{"activo":true,"inicio":9,"fin":17},
         "domingo":{"activo":false}
       }'::jsonb
 WHERE id IN (2, 3, 5, 9, 101, 102, 103, 104, 105, 106, 1001)
   AND weekly_schedule IS NULL;

-- ─── 3. Catálogo de servicios ──────────────────────────────────────────────
-- Precios en COP, múltiplos de 1.000, con IVA incluido en vitrina.
-- Anti-join por (provider_id, name): no duplica y no toca servicios ajenos.
INSERT INTO services (provider_id, name, description, price, duration_minutes, category, is_active, tenant_id)
SELECT v.provider_id, v.name, v.description, v.price, v.duration_minutes, v.category, true, 1
  FROM (VALUES
    (2,    'Corte + lavado',                 'Corte con lavado y secado',           65000,  45, 'Cabello'),
    (2,    'Balayage completo',              'Aclarado y matizado',                320000, 150, 'Cabello'),
    (2,    'Cepillado',                      'Peinado con secador',                 45000,  40, 'Cabello'),
    (3,    'Manicura semipermanente',        'Esmaltado de larga duración',         55000,  60, 'Uñas'),
    (3,    'Pedicura spa',                   'Pedicura con exfoliación',            70000,  75, 'Uñas'),
    (5,    'Corte tendencia + cepillado',    'Corte y peinado',                     85000,  60, 'Cabello'),
    (5,    'Balayage cenizo + hidratación',  'Color con tratamiento',              320000, 180, 'Cabello'),
    (5,    'Maquillaje profesional de noche','Maquillaje social',                   180000,  90, 'Maquillaje'),
    (5,    'Manicura + pedicura spa',        'Combo de uñas',                       95000,  80, 'Uñas'),
    (9,    'Limpieza facial express',        'Limpieza con mascarilla',             90000,  45, 'Facial'),
    (9,    'Maquillaje de día',              'Look natural',                       110000,  50, 'Maquillaje'),
    (101,  'Corte mujer',                    'Corte y secado',                      70000,  45, 'Cabello'),
    (101,  'Color raíz',                     'Retoque de raíz',                    120000,  90, 'Cabello'),
    (101,  'Hidratación profunda',           'Tratamiento capilar',                 60000,  45, 'Cabello'),
    (102,  'Corte barber',                   'Corte a máquina y tijera',            45000,  40, 'Barbería'),
    (102,  'Arreglo de barba',               'Perfilado y aceite',                  30000,  30, 'Barbería'),
    (102,  'Corte + barba',                  'Combo completo',                      65000,  60, 'Barbería'),
    (103,  'Maquillaje social',              'Maquillaje para evento',             150000,  60, 'Maquillaje'),
    (103,  'Maquillaje de novia',            'Prueba y día del evento',            350000, 120, 'Maquillaje'),
    (103,  'Extensión de pestañas',          'Pelo a pelo',                         90000,  90, 'Pestañas'),
    (104,  'Manicura clásica',               'Limado y esmaltado',                  50000,  45, 'Uñas'),
    (104,  'Uñas acrílicas',                 'Set completo',                       110000,  90, 'Uñas'),
    (104,  'Pedicura',                       'Cuidado de pies',                     65000,  60, 'Uñas'),
    (105,  'Limpieza facial profunda',       'Extracción e hidratación',           120000,  60, 'Facial'),
    (105,  'Depilación con cera',            'Zona a elegir',                       80000,  45, 'Depilación'),
    (105,  'Masaje relajante',               '60 minutos',                         110000,  60, 'Masaje'),
    (106,  'Keratina',                       'Alisado con queratina',              250000, 150, 'Cabello'),
    (106,  'Corte y peinado de evento',      'Peinado con plancha',                 70000,  60, 'Cabello'),
    (106,  'Hidratación profunda',           'Ampolla y masaje',                    60000,  45, 'Cabello'),
    (1001, 'Corte urbano',                   'Fade y diseño',                       40000,  40, 'Barbería'),
    (1001, 'Afeitado clásico',               'Navaja y toalla caliente',            35000,  30, 'Barbería')
  ) AS v(provider_id, name, description, price, duration_minutes, category)
 WHERE NOT EXISTS (
   SELECT 1 FROM services s
    WHERE s.provider_id = v.provider_id AND s.name = v.name
 );

COMMIT;

-- ─── Verificación ──────────────────────────────────────────────────────────
-- Debe devolver 11 y 31 (o más si la base ya tenía servicios propios):
--   SELECT count(*) FROM perfiles_prestador
--    WHERE id IN (2,3,5,9,101,102,103,104,105,106,1001)
--      AND estatus_verificacion = 'APROBADO' AND ubicacion IS NOT NULL AND is_active;
--   SELECT count(*) FROM services WHERE provider_id IN (2,3,5,9,101,102,103,104,105,106,1001);

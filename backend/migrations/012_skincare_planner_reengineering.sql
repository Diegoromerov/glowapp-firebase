-- backend/migrations/012_skincare_planner_reengineering.sql
-- Migración consolidada para el módulo Skincare & Haircare Planner en GlowApp

-- 1. Diagnóstico secuencial de doble capa (Item 1)
ALTER TABLE ai_diagnostics ADD COLUMN IF NOT EXISTS comparison_photo_url TEXT;
ALTER TABLE ai_diagnostics ADD COLUMN IF NOT EXISTS comparison_delta JSONB;

-- 2. Perfil de piel persistente y evolutivo (Item 2)
CREATE TABLE IF NOT EXISTS skin_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo_piel VARCHAR(50),
  hidratacion_promedio INTEGER,
  tendencia_acne INTEGER,
  sensibilidad_score INTEGER,
  diagnosticos_count INTEGER DEFAULT 0,
  ultimo_diagnostico_at TIMESTAMPTZ,
  atributos_adicionales JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_user_profile UNIQUE (user_id)
);
CREATE INDEX IF NOT EXISTS idx_skin_profiles_user ON skin_profiles(user_id);

-- 3. GlowAI Premium (Item 4)
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS glowai_plan VARCHAR(20) DEFAULT 'free';
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS glowai_diagnosticos_mes INTEGER DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS glowai_ciclo_reset_at TIMESTAMPTZ DEFAULT NOW();

-- 4. Recomendación de productos con comisión de afiliado (Item 5)
CREATE TABLE IF NOT EXISTS affiliate_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(200) NOT NULL,
  marca VARCHAR(100),
  objetivo VARCHAR(50),
  url_afiliado TEXT NOT NULL,
  comision_pct DECIMAL(5,2),
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Rutinas patrocinadas por marca - canal B2B (Item 7)
CREATE TABLE IF NOT EXISTS brand_sponsorships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marca VARCHAR(100) NOT NULL,
  objetivo_target VARCHAR(50) NOT NULL,
  nombre_rutina VARCHAR(200),
  descripcion TEXT,
  producto_destacado VARCHAR(200),
  logo_url TEXT,
  activo BOOLEAN DEFAULT TRUE,
  fecha_inicio DATE,
  fecha_fin DATE
);

-- 6. Sistema de racha de rutina con recompensas (Item 8)
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS streak_actual INTEGER DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS streak_maximo INTEGER DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS streak_ultimo_registro DATE;

-- 7. Rutinas compartibles con link de referido (Item 9)
CREATE TABLE IF NOT EXISTS referidos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referidor_user_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  codigo VARCHAR(20) UNIQUE NOT NULL,
  clicks INTEGER DEFAULT 0,
  conversiones INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Dashboard de progreso de piel con scoring visual (Item 10)
ALTER TABLE ai_diagnostics ADD COLUMN IF NOT EXISTS score_hidratacion INTEGER;
ALTER TABLE ai_diagnostics ADD COLUMN IF NOT EXISTS score_impurezas INTEGER;
ALTER TABLE ai_diagnostics ADD COLUMN IF NOT EXISTS score_luminosidad INTEGER;

-- 9. Track capilar separado con diagnóstico dedicado (Item 11)
ALTER TABLE ai_diagnostics ADD COLUMN IF NOT EXISTS track VARCHAR(20) DEFAULT 'piel' CHECK (track IN ('piel', 'capilar'));

-- 10. Alianza con dermatólogos - derivación calificada (Item 12)
CREATE TABLE IF NOT EXISTS profesionales_medicos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(200) NOT NULL,
  especialidad VARCHAR(100) DEFAULT 'Dermatología',
  registro_medico VARCHAR(100),
  telefono VARCHAR(20),
  email VARCHAR(200),
  ciudad VARCHAR(100) DEFAULT 'Bogotá',
  foto_url TEXT,
  membresia_activa BOOLEAN DEFAULT FALSE,
  condiciones_tratadas TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seeding para productos de afiliado
INSERT INTO affiliate_products (nombre, marca, objetivo, url_afiliado, comision_pct)
SELECT 'Sérum Hidratante Concentrado', 'Avon', 'Hidratación', 'https://avon.com.co/sku-1', 12.50
WHERE NOT EXISTS (SELECT 1 FROM affiliate_products WHERE objetivo = 'Hidratación');

INSERT INTO affiliate_products (nombre, marca, objetivo, url_afiliado, comision_pct)
SELECT 'Gel Purificante Antiacné', 'Yanbal', 'Acné/Impurezas', 'https://yanbal.com.co/sku-2', 15.00
WHERE NOT EXISTS (SELECT 1 FROM affiliate_products WHERE objetivo = 'Acné/Impurezas');

INSERT INTO affiliate_products (nombre, marca, objetivo, url_afiliado, comision_pct)
SELECT 'Crema Rejuvenecedora L''Bel', 'L''Bel', 'Antiedad', 'https://lbel.com/sku-3', 10.00
WHERE NOT EXISTS (SELECT 1 FROM affiliate_products WHERE objetivo = 'Antiedad');

INSERT INTO affiliate_products (nombre, marca, objetivo, url_afiliado, comision_pct)
SELECT 'Sérum Aclarante e Iluminador', 'Avon', 'Luminosidad/Manchas', 'https://avon.com.co/sku-4', 12.50
WHERE NOT EXISTS (SELECT 1 FROM affiliate_products WHERE objetivo = 'Luminosidad/Manchas');

INSERT INTO affiliate_products (nombre, marca, objetivo, url_afiliado, comision_pct)
SELECT 'Loción Facial Calmante', 'Yanbal', 'Sensibilidad', 'https://yanbal.com.co/sku-5', 15.00
WHERE NOT EXISTS (SELECT 1 FROM affiliate_products WHERE objetivo = 'Sensibilidad');

-- Seeding para patrocinios de marca B2B
INSERT INTO brand_sponsorships (marca, objetivo_target, nombre_rutina, descripcion, producto_destacado, logo_url)
SELECT 'La Roche-Posay', 'Acné/Impurezas', 'Rutina de Control Effaclar', 'Rutina recomendada por dermatólogos para purificar poros y reducir imperfecciones.', 'Effaclar Gel Limpiador Purificante', 'https://dummy-logo-laroche.png'
WHERE NOT EXISTS (SELECT 1 FROM brand_sponsorships WHERE marca = 'La Roche-Posay');

INSERT INTO brand_sponsorships (marca, objetivo_target, nombre_rutina, descripcion, producto_destacado, logo_url)
SELECT 'Cerave', 'Hidratación', 'Rutina de Barrera Protectora', 'Especialmente formulada con 3 ceramidas esenciales para restaurar la barrera de tu piel.', 'Crema Hidratante Cerave', 'https://dummy-logo-cerave.png'
WHERE NOT EXISTS (SELECT 1 FROM brand_sponsorships WHERE marca = 'Cerave');

-- Seeding para dermatólogos asociados
INSERT INTO profesionales_medicos (nombre, especialidad, registro_medico, telefono, email, membresia_activa, condiciones_tratadas)
SELECT 'Dra. María Camila Restrepo', 'Dermatología Clínica y Estética', 'RM-8394-COL', '+573151234567', 'camila.dermatologia@gmail.com', TRUE, ARRAY['Acné severo', 'Rosácea', 'Resequedad extrema']
WHERE NOT EXISTS (SELECT 1 FROM profesionales_medicos WHERE nombre = 'Dra. María Camila Restrepo');

INSERT INTO profesionales_medicos (nombre, especialidad, registro_medico, telefono, email, membresia_activa, condiciones_tratadas)
SELECT 'Dr. Juan Fernando Hoyos', 'Dermatología Oncológica y Tricología', 'RM-1049-COL', '+573109876543', 'hoyos.dermato@outlook.com', TRUE, ARRAY['Caída de cabello', 'Dermatitis seborreica', 'Psoriasis']
WHERE NOT EXISTS (SELECT 1 FROM profesionales_medicos WHERE nombre = 'Dr. Juan Fernando Hoyos');

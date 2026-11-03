-- ============================================
-- Beauty App - Schema Completo con PostGIS y SERIAL IDs
-- Ejecutar en PostgreSQL 15+ con extensión postgis
-- ============================================

-- 1. Activar PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. Eliminar tipos y tablas antiguas si existen para recrear limpio
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS reviews CASCADE;
DROP TABLE IF EXISTS portfolio_items CASCADE;
DROP TABLE IF EXISTS bookings CASCADE;
DROP TABLE IF EXISTS services CASCADE;
DROP TABLE IF EXISTS perfiles_prestador CASCADE;
DROP TABLE IF EXISTS usuarios CASCADE;
DROP TABLE IF EXISTS providers CASCADE;
DROP TABLE IF EXISTS clients CASCADE;
DROP TABLE IF EXISTS users CASCADE;

DROP TYPE IF EXISTS estado_verificacion CASCADE;
DROP TYPE IF EXISTS tipo_rol CASCADE;
DROP TYPE IF EXISTS tipo_auth_provider CASCADE;
DROP TYPE IF EXISTS tipo_metodo_retiro CASCADE;
DROP TYPE IF EXISTS estado_cita CASCADE;

-- 3. Crear Enums
CREATE TYPE tipo_auth_provider AS ENUM ('GOOGLE', 'OUTLOOK', 'LOCAL', 'APPLE');
CREATE TYPE tipo_rol AS ENUM ('CLIENTE', 'PRESTADOR');
CREATE TYPE estado_verificacion AS ENUM ('PENDIENTE', 'APROBADO', 'RECHAZADO');
CREATE TYPE tipo_metodo_retiro AS ENUM ('NEQUI', 'BANCARIA');
CREATE TYPE estado_cita AS ENUM (
  'PENDIENTE_PAGO',
  'CONFIRMADA',
  'EN_PROGRESO',
  'FINALIZADA_PRESTADOR',
  'COMPLETADA',
  'CANCELADA'
);

-- 4. Tabla usuarios (Auth unificado + Onboarding)
CREATE TABLE usuarios (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  nombre VARCHAR(255) NOT NULL,
  foto_url TEXT,
  auth_provider tipo_auth_provider NOT NULL,
  provider_id VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255),
  phone VARCHAR(20),
  rol tipo_rol DEFAULT NULL,
  onboarding_completo BOOLEAN DEFAULT FALSE,
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_auth_provider_id UNIQUE (auth_provider, provider_id)
);

-- 5. Tabla perfiles_prestador (Micro-logística + Cumplimiento Legal)
CREATE TABLE perfiles_prestador (
  id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  business_name VARCHAR(255),
  description TEXT,
  is_online BOOLEAN DEFAULT FALSE,
  ubicacion GEOGRAPHY(Point, 4326),
  portafolio_servicios JSONB DEFAULT '[]'::jsonb,
  documento_id_url TEXT,
  rut_url TEXT,
  certificacion_url TEXT,
  estatus_verificacion estado_verificacion DEFAULT 'PENDIENTE',
  rating_avg NUMERIC(3,2) DEFAULT 0.0 CHECK (rating_avg >= 0 AND rating_avg <= 5),
  rating_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  metodo_retiro tipo_metodo_retiro DEFAULT 'NEQUI',
  numero_cuenta_nequi VARCHAR(20),
  documento_titular VARCHAR(20),
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Índice espacial GiST para consultas hiper-locales
CREATE INDEX idx_perfiles_prestador_ubicacion ON perfiles_prestador USING GIST (ubicacion);

-- 7. Tabla services
CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id INTEGER NOT NULL REFERENCES perfiles_prestador(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  category VARCHAR(50),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Tabla bookings (Reservas + Reparto Financiero 20% / 8%)
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  provider_id INTEGER NOT NULL REFERENCES perfiles_prestador(id) ON DELETE RESTRICT,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  valor_bruto NUMERIC(10,2) NOT NULL CHECK (valor_bruto >= 0),
  comision_plataforma NUMERIC(10,2) DEFAULT 0.00,
  impuestos_estado NUMERIC(10,2) DEFAULT 0.00,
  pago_neto_prestador NUMERIC(10,2) DEFAULT 0.00,
  estado estado_cita DEFAULT 'PENDIENTE_PAGO',
  pin_verificacion VARCHAR(4),
  payment_status VARCHAR(20) DEFAULT 'unpaid',
  service_address TEXT,
  -- Dirección estructurada Bogotá (ej: Calle 80 # 12-34, Apto 201, Chapinero)
  tipo_via            TEXT,           -- Calle, Carrera, Diagonal, Transversal, Avenida...
  numero_via          TEXT,           -- 80, 13, 127B...
  numero_placa        TEXT,           -- # 12-34
  numero_complemento  TEXT,           -- Apto, Of., Casa...
  complemento_interior TEXT,          -- 201, local 3...
  barrio              TEXT,           -- Chapinero, Usaquén, Suba...
  localidad           TEXT,           -- Bogotá tiene 20 localidades
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION calc_booking_split()
RETURNS TRIGGER AS $$
BEGIN
  -- La comisión total cobrada al prestador es del 20%, la cual contiene un 8% de impuestos y 12% de comisión neta.
  NEW.comision_plataforma := ROUND(NEW.valor_bruto * 0.12, 2);
  NEW.impuestos_estado := ROUND(NEW.valor_bruto * 0.08, 2);
  NEW.pago_neto_prestador := NEW.valor_bruto - (NEW.comision_plataforma + NEW.impuestos_estado);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER before_booking_insert_update
BEFORE INSERT OR UPDATE OF valor_bruto ON bookings
FOR EACH ROW EXECUTE FUNCTION calc_booking_split();

-- 10. Tabla reviews
CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID UNIQUE NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  provider_id INTEGER NOT NULL REFERENCES perfiles_prestador(id) ON DELETE RESTRICT,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. Tabla portfolio_items
CREATE TABLE portfolio_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id INTEGER NOT NULL REFERENCES perfiles_prestador(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  title VARCHAR(255),
  category VARCHAR(50),
  likes_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. Tabla messages (Chat)
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  receiver_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_messages_sender_receiver ON messages(sender_id, receiver_id);
CREATE INDEX idx_messages_created_at ON messages(created_at DESC);

-- 13. Tabla transactions (Historial financiero)
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID UNIQUE NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'refunded', 'failed')),
  payment_method VARCHAR(50),
  external_id VARCHAR(255),
  created_en TIMESTAMPTZ DEFAULT NOW()
);

-- 14. Tabla nail_tryon_jobs (Pruebas virtuales de uñas)
CREATE TABLE nail_tryon_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  color_hex VARCHAR(7),
  shape VARCHAR(50),
  finish VARCHAR(50),
  decoration_style VARCHAR(100),
  original_image_url TEXT NOT NULL,
  preview_url TEXT,
  error_message TEXT,
  image_hash VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_nail_tryon_jobs_user ON nail_tryon_jobs(user_id);
CREATE INDEX idx_nail_tryon_jobs_expires ON nail_tryon_jobs(expires_at);

-- 15. Tabla productos (Tienda en línea de GlowApp)
CREATE TABLE IF NOT EXISTS productos (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(255) NOT NULL,
  descripcion TEXT,
  precio NUMERIC(10,2) NOT NULL CHECK (precio >= 0),
  stock INT DEFAULT 0 CHECK (stock >= 0),
  imagen_url TEXT,
  tag_especialidad VARCHAR(50) NOT NULL,
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

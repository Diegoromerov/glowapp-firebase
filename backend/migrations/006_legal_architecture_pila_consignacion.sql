-- Migración 006: Adaptación de la arquitectura de base de datos para la legalidad contractual de GlowApp

-- 1. Soporte para Planilla PILA en perfiles_prestador (Cláusula Décima del Contrato)
ALTER TABLE perfiles_prestador 
ADD COLUMN ultimo_pago_pila_fecha DATE DEFAULT NULL,
ADD COLUMN pila_soporte_url TEXT DEFAULT NULL,
ADD COLUMN pila_estado_verificacion VARCHAR(20) DEFAULT 'PENDIENTE' CHECK (pila_estado_verificacion IN ('PENDIENTE', 'APROBADO', 'RECHAZADO', 'VENCIDO')),
ADD COLUMN suspension_pila BOOLEAN DEFAULT FALSE;

-- 2. Consignación de productos por prestador (Cláusula Sexta del Contrato)
CREATE TABLE IF NOT EXISTS inventario_consignacion_prestador (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES perfiles_prestador(id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  cantidad_entregada INT NOT NULL CHECK (cantidad_entregada >= 0),
  cantidad_vendida INT DEFAULT 0 CHECK (cantidad_vendida >= 0),
  lote VARCHAR(50),
  fecha_vencimiento DATE,
  fecha_entrega TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Productos vendidos y comisiones causadas en citas (Cláusula Séptima del Contrato)
CREATE TABLE IF NOT EXISTS booking_productos (
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  cantidad INT DEFAULT 1,
  tipo_comision VARCHAR(20) DEFAULT 'ENTREGA' CHECK (tipo_comision IN ('SUGERIDA', 'ENTREGA')),
  comision_causada NUMERIC(10,2) NOT NULL,
  PRIMARY KEY (booking_id, producto_id)
);

-- 4. Registro de Auditoría de Consentimiento de Datos Biométricos Sensibles e IA (Política de Privacidad e IA)
CREATE TABLE IF NOT EXISTS auditoria_consentimiento_biometrico (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  consentimiento_otorgado BOOLEAN DEFAULT FALSE,
  version_politica VARCHAR(10) NOT NULL,
  ip_registro VARCHAR(45) NOT NULL,
  dispositivo TEXT,
  fecha_registro TIMESTAMPTZ DEFAULT NOW()
);

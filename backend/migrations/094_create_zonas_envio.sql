-- 094_create_zonas_envio.sql
-- Migración L5: Motor de cotización de envío por zonas

-- Crear tabla de zonas de envío
CREATE TABLE IF NOT EXISTS zonas_envio (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ciudad VARCHAR(100) NOT NULL,
  departamento VARCHAR(100) NOT NULL,
  codigo_postal_prefijo VARCHAR(6),           -- primeros 2-3 dígitos (ej: '05' para Medellín)
  tarifa_base NUMERIC(10,2) NOT NULL DEFAULT 12000,
  tarifa_por_kg NUMERIC(10,2) DEFAULT 0,
  gratis_desde_monto NUMERIC(10,2),           -- envío gratis si pedido >= X
  transportadora_default VARCHAR(100),        -- 'Inter Rapidísimo', 'Servientrega', etc.
  dias_estimados_min INT DEFAULT 2,
  dias_estimados_max INT DEFAULT 5,
  activa BOOLEAN DEFAULT TRUE,
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (ciudad, departamento, codigo_postal_prefijo)
);

-- Índice para lookup rápido
CREATE INDEX IF NOT EXISTS idx_zonas_envio_lookup ON zonas_envio (ciudad, departamento, codigo_postal_prefijo) WHERE activa;

-- Comentarios
COMMENT ON TABLE zonas_envio IS 'Zonas de envío con tarifas por ciudad/departamento/código postal para GlowStore';
COMMENT ON COLUMN zonas_envio.codigo_postal_prefijo IS 'Prefijo del código postal (ej: 05 para Medellín, 11 para Bogotá). NULL = aplica a toda la ciudad';
COMMENT ON COLUMN zonas_envio.gratis_desde_monto IS 'Monto mínimo del pedido para envío gratis. NULL = no aplica';
COMMENT ON COLUMN zonas_envio.transportadora_default IS 'Transportadora sugerida para despacho automático';

-- Seed inicial: ciudades principales + fallback "OTRO"
INSERT INTO zonas_envio (ciudad, departamento, codigo_postal_prefijo, tarifa_base, tarifa_por_kg, gratis_desde_monto, transportadora_default, dias_estimados_min, dias_estimados_max) VALUES
  ('Medellín', 'Antioquia', '05', 10000.00, 500.00, 480000.00, 'Inter Rapidísimo', 1, 3),
  ('Bogotá', 'Bogotá D.C.', '11', 9000.00, 400.00, 300000.00, 'Servientrega', 1, 3),
  ('Cali', 'Valle del Cauca', '76', 11000.00, 600.00, 480000.00, 'Coordinadora', 2, 4),
  ('Barranquilla', 'Atlántico', '08', 12000.00, 500.00, 480000.00, 'Inter Rapidísimo', 2, 4),
  ('Cartagena', 'Bolívar', '13', 13000.00, 600.00, 480000.00, 'Servientrega', 2, 5),
  ('Bucaramanga', 'Santander', '68', 12000.00, 500.00, 480000.00, 'Coordinadora', 2, 4),
  ('Pereira', 'Risaralda', '66', 11000.00, 500.00, 480000.00, 'Inter Rapidísimo', 2, 4),
  ('Manizales', 'Caldas', '17', 12000.00, 500.00, 480000.00, 'Servientrega', 2, 4),
  ('Santa Marta', 'Magdalena', '47', 14000.00, 700.00, 480000.00, 'Coordinadora', 3, 5),
  ('Villavicencio', 'Meta', '50', 15000.00, 800.00, 480000.00, 'Inter Rapidísimo', 3, 5),
  ('Pasto', 'Nariño', '52', 16000.00, 800.00, 480000.00, 'Servientrega', 3, 6),
  ('Neiva', 'Huila', '41', 14000.00, 600.00, 480000.00, 'Coordinadora', 2, 5),
  ('Armenia', 'Quindío', '63', 11000.00, 500.00, 480000.00, 'Inter Rapidísimo', 2, 4),
  ('Ibagué', 'Tolima', '73', 13000.00, 600.00, 480000.00, 'Servientrega', 2, 4),
  ('Montería', 'Córdoba', '23', 14000.00, 700.00, 480000.00, 'Inter Rapidísimo', 3, 5),
  ('Sincelejo', 'Sucre', '70', 13000.00, 600.00, 480000.00, 'Coordinadora', 3, 5),
  ('Valledupar', 'Cesar', '20', 15000.00, 700.00, 480000.00, 'Servientrega', 3, 5),
  ('Riohacha', 'La Guajira', '44', 18000.00, 1000.00, 480000.00, 'Coordinadora', 4, 7),
  ('Quibdó', 'Chocó', '27', 20000.00, 1200.00, 480000.00, 'Inter Rapidísimo', 4, 8),
  ('Leticia', 'Amazonas', '91', 35000.00, 2000.00, 480000.00, 'Servientrega', 5, 10),
  -- Fallback para ciudades no listadas
  ('OTRO', 'OTRO', NULL, 15000.00, 800.00, 480000.00, 'Coordinadora', 3, 6)
ON CONFLICT (ciudad, departamento, codigo_postal_prefijo) DO NOTHING;
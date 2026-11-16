-- Migración 167: Catálogo completo de municipios DANE (1122 municipios Colombia)
-- Fuente: DANE 2023. Incluye código DANE 5 dígitos, nombre, departamento, lat/lon para geocoding.
-- Ejecutar ANTES de migración 168 (routing rules seed) para que FK zona_id funcione.

CREATE TABLE IF NOT EXISTS municipios_dane (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dane_code VARCHAR(5) NOT NULL UNIQUE,          -- 5 dígitos: DDDMM (depto 2 + municipio 3)
  nombre VARCHAR(100) NOT NULL,
  departamento_codigo VARCHAR(2) NOT NULL,       -- Código DANE departamento (2 dígitos)
  departamento_nombre VARCHAR(50) NOT NULL,
  latitud NUMERIC(9,6),
  longitud NUMERIC(9,6),
  zona_envio_id UUID REFERENCES zonas_envio(id), -- Vinculación a zona de envío (NULL = fallback OTRO)
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_municipios_dane_code ON municipios_dane(dane_code);
CREATE INDEX idx_municipios_dane_depto ON municipios_dane(departamento_codigo);
CREATE INDEX idx_municipios_dane_zona ON municipios_dane(zona_envio_id) WHERE zona_envio_id IS NOT NULL;

-- RLS
ALTER TABLE municipios_dane ENABLE ROW LEVEL SECURITY;
ALTER TABLE municipios_dane FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS municipios_dane_admin_all ON municipios_dane;
CREATE POLICY municipios_dane_admin_all ON municipios_dane
  FOR ALL TO app_rls_user
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

DROP POLICY IF EXISTS municipios_dane_system_all ON municipios_dane;
CREATE POLICY municipios_dane_system_all ON municipios_dane
  FOR ALL TO app_rls_user
  USING (current_setting('app.tenant_id', true) = current_setting('app.platform_tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) = current_setting('app.platform_tenant_id', true));

DROP POLICY IF EXISTS municipios_dane_read_all ON municipios_dane;
CREATE POLICY municipios_dane_read_all ON municipios_dane
  FOR SELECT TO app_rls_user
  USING (true);

COMMENT ON TABLE municipios_dane IS 'Catálogo oficial DANE de 1122 municipios Colombia. Usado para validación de direcciones y cálculo de fletes.';
COMMENT ON COLUMN municipios_dane.dane_code IS 'Código DANE 5 dígitos: primeros 2 = departamento, últimos 3 = municipio';
COMMENT ON COLUMN municipios_dane.zona_envio_id IS 'Vinculación a zona_envio para tarifas; NULL = usa zona OTRO';

-- Seed: 10 ciudades principales (cobertura 95% volumen) + zona OTRO fallback
-- Resto de 1112 municipios se carga por script CSV o migración posterior
INSERT INTO municipios_dane (dane_code, nombre, departamento_codigo, departamento_nombre, latitud, longitud, zona_envio_id) VALUES
-- Bogotá D.C. (código depto 11)
('11001', 'Bogotá', '11', 'Bogotá D.C.', 4.7110, -74.0721, (SELECT id FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'bogota' ORDER BY activa DESC NULLS LAST LIMIT 1)),

-- Antioquia (05)
('05001', 'Medellín', '05', 'Antioquia', 6.2442, -75.5812, (SELECT id FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'medellin' ORDER BY activa DESC NULLS LAST LIMIT 1)),
('05088', 'Bello', '05', 'Antioquia', 6.3369, -75.5619, (SELECT id FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'medellin' ORDER BY activa DESC NULLS LAST LIMIT 1)),
('05266', 'Itagüí', '05', 'Antioquia', 6.1736, -75.6031, (SELECT id FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'medellin' ORDER BY activa DESC NULLS LAST LIMIT 1)),
('05360', 'Envigado', '05', 'Antioquia', 6.1747, -75.5914, (SELECT id FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'medellin' ORDER BY activa DESC NULLS LAST LIMIT 1)),

-- Valle del Cauca (76)
('76001', 'Cali', '76', 'Valle del Cauca', 3.4516, -76.5320, (SELECT id FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'cali' ORDER BY activa DESC NULLS LAST LIMIT 1)),
('76520', 'Palmira', '76', 'Valle del Cauca', 3.5394, -76.3036, (SELECT id FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'cali' ORDER BY activa DESC NULLS LAST LIMIT 1)),

-- Atlántico (08)
('08001', 'Barranquilla', '08', 'Atlántico', 10.9639, -74.7964, (SELECT id FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'barranquilla' ORDER BY activa DESC NULLS LAST LIMIT 1)),
('08758', 'Soledad', '08', 'Atlántico', 10.9181, -74.7664, (SELECT id FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'barranquilla' ORDER BY activa DESC NULLS LAST LIMIT 1)),

-- Bolívar (13)
('13001', 'Cartagena', '13', 'Bolívar', 10.3910, -75.4794, (SELECT id FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'cartagena' ORDER BY activa DESC NULLS LAST LIMIT 1)),

-- Santander (68)
('68001', 'Bucaramanga', '68', 'Santander', 7.1193, -73.1227, (SELECT id FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'bucaramanga' ORDER BY activa DESC NULLS LAST LIMIT 1)),
('68344', 'Floridablanca', '68', 'Santander', 7.0583, -73.0881, (SELECT id FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'bucaramanga' ORDER BY activa DESC NULLS LAST LIMIT 1)),

-- Cundinamarca (25) - municipios aledaños a Bogotá
('25175', 'Chía', '25', 'Cundinamarca', 4.8583, -74.0597, (SELECT id FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'bogota' ORDER BY activa DESC NULLS LAST LIMIT 1)),
('25483', 'Soacha', '25', 'Cundinamarca', 4.5853, -74.2114, (SELECT id FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'bogota' ORDER BY activa DESC NULLS LAST LIMIT 1)),
('25599', 'Facatativá', '25', 'Cundinamarca', 4.8167, -74.3500, (SELECT id FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'bogota' ORDER BY activa DESC NULLS LAST LIMIT 1)),

-- Risaralda (66)
('66001', 'Pereira', '66', 'Risaralda', 4.8133, -75.6947, (SELECT id FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'pereira' ORDER BY activa DESC NULLS LAST LIMIT 1)),
('66170', 'Dosquebradas', '66', 'Risaralda', 4.8333, -75.6500, (SELECT id FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'pereira' ORDER BY activa DESC NULLS LAST LIMIT 1)),

-- Caldas (17)
('17001', 'Manizales', '17', 'Caldas', 5.0689, -75.5174, (SELECT id FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'manizales' ORDER BY activa DESC NULLS LAST LIMIT 1)),

-- Tolima (73)
('73001', 'Ibagué', '73', 'Tolima', 4.4389, -75.2322, (SELECT id FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'ibague' ORDER BY activa DESC NULLS LAST LIMIT 1)),

-- Meta (50)
('50001', 'Villavicencio', '50', 'Meta', 4.1420, -73.6256, (SELECT id FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'villavicencio' ORDER BY activa DESC NULLS LAST LIMIT 1)),

-- Norte de Santander (54)
('54001', 'Cúcuta', '54', 'Norte de Santander', 7.8939, -72.5078, (SELECT id FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'cucuta' ORDER BY activa DESC NULLS LAST LIMIT 1)),

-- Magdalena (47)
('47001', 'Santa Marta', '47', 'Magdalena', 11.2404, -74.1990, (SELECT id FROM zonas_envio WHERE lower(ciudad) = 'santa marta' AND lower(departamento) = 'magdalena' LIMIT 1)),

-- Quindío (63)
('63001', 'Armenia', '63', 'Quindío', 4.5339, -75.6811, (SELECT id FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'armenia' ORDER BY activa DESC NULLS LAST LIMIT 1)),

-- Cauca (19)
('19001', 'Popayán', '19', 'Cauca', 2.4448, -76.6147, (SELECT id FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'popayan' ORDER BY activa DESC NULLS LAST LIMIT 1)),

-- Boyacá (15)
('15001', 'Tunja', '15', 'Boyacá', 5.5353, -73.3622, (SELECT id FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'tunja' ORDER BY activa DESC NULLS LAST LIMIT 1)),

-- Cesar (20)
('20001', 'Valledupar', '20', 'Cesar', 10.4631, -73.2536, (SELECT id FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'valledupar' ORDER BY activa DESC NULLS LAST LIMIT 1)),

-- Córdoba (23)
('23001', 'Montería', '23', 'Córdoba', 8.7480, -75.8814, (SELECT id FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'monteria' ORDER BY activa DESC NULLS LAST LIMIT 1)),

-- Sucre (70)
('70001', 'Sincelejo', '70', 'Sucre', 9.3047, -75.3978, (SELECT id FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'sincelejo' ORDER BY activa DESC NULLS LAST LIMIT 1)),

-- Nariño (52)
('52001', 'Pasto', '52', 'Nariño', 1.2136, -77.2811, (SELECT id FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'pasto' ORDER BY activa DESC NULLS LAST LIMIT 1)),

-- Huila (41)
('41001', 'Neiva', '41', 'Huila', 2.9273, -75.2819, (SELECT id FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'neiva' ORDER BY activa DESC NULLS LAST LIMIT 1)),

-- Casanare (85)
('85001', 'Yopal', '85', 'Casanare', 5.3378, -72.3959, (SELECT id FROM zonas_envio WHERE lower(translate(ciudad,'áéíóúüñ','aeiouun')) = 'yopal' ORDER BY activa DESC NULLS LAST LIMIT 1)),

-- Quindío - zona OTRO fallback (para municipios sin zona específica)
('99999', 'OTRO - Fallback Nacional', '99', 'OTRO', 4.7110, -74.0721, NULL)
ON CONFLICT (dane_code) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  departamento_codigo = EXCLUDED.departamento_codigo,
  departamento_nombre = EXCLUDED.departamento_nombre,
  latitud = EXCLUDED.latitud,
  longitud = EXCLUDED.longitud,
  zona_envio_id = EXCLUDED.zona_envio_id,
  activo = EXCLUDED.activo;

-- Nota: Los 1122 municipios completos se cargan via script CSV separado (scripts/load_municipios_dane.js)
-- Esta migración solo crea la tabla y sanea las 25 ciudades principales con vinculación a zonas_envio.
-- Migración 073: Direcciones de entrega estructuradas (formato colombiano)
-- Cada usuario puede tener múltiples direcciones; una marcada como default

CREATE TABLE IF NOT EXISTS user_delivery_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  
  -- Estructura de dirección colombiana
  tipo_via VARCHAR(30) NOT NULL,           -- Calle, Carrera, Avenida, Diagonal, Transversal, Circular, etc.
  numero_principal VARCHAR(10) NOT NULL,   -- Nº principal (ej: 123)
  letra_principal VARCHAR(5),              -- Letra/Bis del principal (ej: A, BIS)
  numero_secundario VARCHAR(10),           -- Nº de cruce (ej: 45)
  letra_secundaria VARCHAR(5),             -- Letra del cruce (ej: 67)
  complemento VARCHAR(100),                -- Apartamento, interior, oficina, casa, torre, bloque, etc.
  barrio VARCHAR(150),                     -- Barrio / sector / urbanización
  ciudad VARCHAR(100) NOT NULL,            -- Ciudad / municipio
  departamento VARCHAR(100) NOT NULL,      -- Departamento
  codigo_postal VARCHAR(10),               -- Código postal (6 dígitos en Colombia)
  referencia TEXT,                         -- Referencia adicional (ej: "frente al parque", "portería 2")
  
  -- Campo computado legible para mostrar en UI
  direccion_formateada TEXT GENERATED ALWAYS AS (
    tipo_via || ' ' || numero_principal ||
    COALESCE(' ' || letra_principal, '') ||
    COALESCE(' #' || numero_secundario, '') ||
    COALESCE('-' || letra_secundaria, '') ||
    COALESCE(' ' || complemento, '') ||
    COALESCE(', ' || barrio, '') ||
    ', ' || ciudad || ', ' || departamento
  ) STORED,
  
  -- Metadatos
  alias VARCHAR(50),                       -- Alias amigable: "Casa", "Oficina", "Casa de mamá"
  es_default BOOLEAN NOT NULL DEFAULT FALSE,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_user_delivery_addresses_user ON user_delivery_addresses(user_id);
CREATE INDEX IF NOT EXISTS idx_user_delivery_addresses_default ON user_delivery_addresses(user_id, es_default) WHERE es_default = TRUE;

-- Trigger para actualizado_en
CREATE OR REPLACE FUNCTION update_user_delivery_addresses_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trigger_update_user_delivery_addresses_updated_at ON user_delivery_addresses;
CREATE TRIGGER trigger_update_user_delivery_addresses_updated_at
BEFORE UPDATE ON user_delivery_addresses
FOR EACH ROW EXECUTE FUNCTION update_user_delivery_addresses_updated_at();

-- Restricción: solo una dirección default por usuario
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_delivery_addresses_one_default
ON user_delivery_addresses(user_id) WHERE es_default = TRUE;

-- Comentarios
COMMENT ON TABLE user_delivery_addresses IS 'Direcciones de entrega estructuradas bajo formato colombiano para GlowStore';
COMMENT ON COLUMN user_delivery_addresses.tipo_via IS 'Tipo de vía: Calle, Carrera, Avenida, Diagonal, Transversal, Circular, Vía, Autopista, etc.';
COMMENT ON COLUMN user_delivery_addresses.numero_principal IS 'Número principal de la vía (ej: 123 en "Calle 123 #45-67")';
COMMENT ON COLUMN user_delivery_addresses.numero_secundario IS 'Número de la vía transversal/cruce (ej: 45 en "Calle 123 #45-67")';
COMMENT ON COLUMN user_delivery_addresses.complemento IS 'Apartamento, interior, oficina, casa, torre, bloque, local, etc.';
COMMENT ON COLUMN user_delivery_addresses.direccion_formateada IS 'Dirección legible auto-generada para mostrar en UI y usar en pedidos';
COMMENT ON COLUMN user_delivery_addresses.alias IS 'Nombre amigable elegido por el usuario';
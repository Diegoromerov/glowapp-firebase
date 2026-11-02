-- 093_add_structured_address_to_pedidos.sql
-- Migración L6: propagar dirección estructurada a pedidos_tienda

-- Añadir columnas de dirección estructurada a pedidos_tienda
ALTER TABLE pedidos_tienda
  ADD COLUMN IF NOT EXISTS tipo_via VARCHAR(30),
  ADD COLUMN IF NOT EXISTS numero_principal VARCHAR(10),
  ADD COLUMN IF NOT EXISTS letra_principal VARCHAR(5),
  ADD COLUMN IF NOT EXISTS numero_secundario VARCHAR(10),
  ADD COLUMN IF NOT EXISTS letra_secundaria VARCHAR(5),
  ADD COLUMN IF NOT EXISTS complemento VARCHAR(100),
  ADD COLUMN IF NOT EXISTS barrio VARCHAR(150),
  ADD COLUMN IF NOT EXISTS ciudad VARCHAR(100),
  ADD COLUMN IF NOT EXISTS departamento VARCHAR(100),
  ADD COLUMN IF NOT EXISTS codigo_postal VARCHAR(10),
  ADD COLUMN IF NOT EXISTS referencia TEXT,
  ADD COLUMN IF NOT EXISTS direccion_entrega_id UUID REFERENCES user_delivery_addresses(id) ON DELETE SET NULL;

-- Comentarios para documentación
COMMENT ON COLUMN pedidos_tienda.tipo_via IS 'Tipo de vía: Calle, Carrera, Avenida, Diagonal, Transversal, Circular, Vía, Autopista, etc.';
COMMENT ON COLUMN pedidos_tienda.numero_principal IS 'Número principal de la vía';
COMMENT ON COLUMN pedidos_tienda.numero_secundario IS 'Número de la vía transversal/cruce';
COMMENT ON COLUMN pedidos_tienda.complemento IS 'Apartamento, interior, oficina, casa, torre, bloque, local, etc.';
COMMENT ON COLUMN pedidos_tienda.barrio IS 'Barrio / sector / urbanización';
COMMENT ON COLUMN pedidos_tienda.ciudad IS 'Ciudad / municipio';
COMMENT ON COLUMN pedidos_tienda.departamento IS 'Departamento';
COMMENT ON COLUMN pedidos_tienda.codigo_postal IS 'Código postal (6 dígitos en Colombia)';
COMMENT ON COLUMN pedidos_tienda.referencia IS 'Referencia adicional (ej: frente al parque, portería 2)';
COMMENT ON COLUMN pedidos_tienda.direccion_entrega_id IS 'FK a user_delivery_addresses para trazabilidad';
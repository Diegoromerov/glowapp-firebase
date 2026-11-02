-- Migración 010: Esquema técnico de GlowStore

-- 0. Registrar nuevo tipo de transacción de billetera para productos
ALTER TYPE tipo_wallet_tx ADD VALUE IF NOT EXISTS 'CREDITO_PRODUCTO';

-- 1. Modificar la tabla productos para agregar columnas de visibilidad y precios diferenciados
ALTER TABLE productos 
  ADD COLUMN IF NOT EXISTS tipo_visibilidad VARCHAR(20) DEFAULT 'PUBLICO' CHECK (tipo_visibilidad IN ('PUBLICO', 'INSUMO_PRESTADOR')),
  ADD COLUMN IF NOT EXISTS precio_al_publico NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (precio_al_publico >= 0),
  ADD COLUMN IF NOT EXISTS precio_con_reserva NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (precio_con_reserva >= 0),
  ADD COLUMN IF NOT EXISTS precio_prestador NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (precio_prestador >= 0),
  ADD COLUMN IF NOT EXISTS comision_prestador NUMERIC(10,2) DEFAULT 0.00 CHECK (comision_prestador >= 0);

-- 2. Migrar los valores existentes (mapear el 'precio' original a las nuevas columnas de precios)
UPDATE productos SET 
  precio_al_publico = precio,
  precio_con_reserva = ROUND(precio * 0.85, 2), -- 15% de descuento por reserva
  precio_prestador = ROUND(precio * 0.65, 2),   -- 35% de descuento (precio mayorista)
  comision_prestador = ROUND(precio * 0.10, 2)  -- 10% de comisión por venta
WHERE tipo_visibilidad = 'PUBLICO' AND precio_al_publico = 0.00;

-- 3. Insertar insumos exclusivos para prestadores (no visibles para clientes)
INSERT INTO productos (nombre, descripcion, precio, precio_al_publico, precio_con_reserva, precio_prestador, comision_prestador, stock, imagen_url, tag_especialidad, tipo_visibilidad)
VALUES 
  (
    'Cera Elástica de Miel (1kg)', 
    'Cera elástica profesional con extracto de miel orgánica. Ideal para depilación de zonas sensibles, alta elasticidad y bajo punto de fusión.', 
    45000.00,
    0.00, 
    0.00, 
    45000.00, 
    0.00, 
    50, 
    'https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?q=80&w=300&auto=format&fit=crop', 
    'Estética', 
    'INSUMO_PRESTADOR'
  ),
  (
    'Kit Pestañas Premium (Melted)', 
    'Kit completo de pestañas pelo a pelo con adhesivo quirúrgico de secado rápido, removedor en gel y pinzas de precisión.', 
    90000.00,
    0.00, 
    0.00, 
    90000.00, 
    0.00, 
    30, 
    'https://images.unsplash.com/photo-1522337360788-8b13df793f1f?q=80&w=300&auto=format&fit=crop', 
    'Maquillaje', 
    'INSUMO_PRESTADOR'
  )
ON CONFLICT DO NOTHING;

-- 4. Crear la tabla pedidos_tienda para el registro de órdenes
CREATE TABLE IF NOT EXISTS pedidos_tienda (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comprador_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  rol_comprador tipo_rol NOT NULL,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  prestador_comisionado_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  comision_total_prestador NUMERIC(10,2) DEFAULT 0.00 CHECK (comision_total_prestador >= 0),
  subtotal NUMERIC(10,2) NOT NULL CHECK (subtotal >= 0),
  envio NUMERIC(10,2) DEFAULT 0.00 CHECK (envio >= 0),
  iva NUMERIC(10,2) DEFAULT 0.00 CHECK (iva >= 0),
  total NUMERIC(10,2) NOT NULL CHECK (total >= 0),
  estado VARCHAR(20) DEFAULT 'PENDIENTE_PAGO' CHECK (estado IN ('PENDIENTE_PAGO', 'PAGADO', 'DESPACHADO', 'ENTREGADO', 'CANCELADO')),
  nombre_entrega VARCHAR(255) NOT NULL,
  direccion_entrega TEXT NOT NULL,
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para optimizar búsquedas frecuentes
CREATE INDEX IF NOT EXISTS idx_pedidos_tienda_comprador ON pedidos_tienda(comprador_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_tienda_booking ON pedidos_tienda(booking_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_tienda_comisionado ON pedidos_tienda(prestador_comisionado_id);

-- 5. Crear la tabla detalles_pedido_tienda
CREATE TABLE IF NOT EXISTS detalles_pedido_tienda (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id UUID NOT NULL REFERENCES pedidos_tienda(id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unitario_pagado NUMERIC(10,2) NOT NULL CHECK (precio_unitario_pagado >= 0),
  comision_unitaria_prestador NUMERIC(10,2) DEFAULT 0.00 CHECK (comision_unitaria_prestador >= 0)
);

CREATE INDEX IF NOT EXISTS idx_detalles_pedido_id ON detalles_pedido_tienda(pedido_id);

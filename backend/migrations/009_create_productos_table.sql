-- Migración 009: Creación de la tabla productos y semilla inicial
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

-- Insertar catálogo de productos de belleza premium si no existen
INSERT INTO productos (nombre, descripcion, precio, stock, imagen_url, tag_especialidad)
VALUES 
  (
    'Shampoo de Argán Orgánico', 
    'Shampoo restaurador con aceite de argán puro de Marruecos. Limpia, hidrata y aporta brillo natural al cabello seco o dañado.', 
    45000.00, 
    50, 
    'https://images.unsplash.com/photo-1535585209827-a15fcdbc4c2d?q=80&w=300&auto=format&fit=crop', 
    'Cabello'
  ),
  (
    'Acondicionador de Coco Nutritivo', 
    'Acondicionador ultra-hidratante formulado con leche de coco orgánica. Desenreda, nutre y previene el frizz.', 
    38000.00, 
    40, 
    'https://images.unsplash.com/photo-1526947425960-945c6e72858f?q=80&w=300&auto=format&fit=crop', 
    'Cabello'
  ),
  (
    'Mascarilla Reparadora de Queratina', 
    'Tratamiento intensivo de queratina para reestructurar la fibra capilar, reducir la horquilla y devolver la sedosidad.', 
    55000.00, 
    30, 
    'https://images.unsplash.com/photo-1608248597279-f99d160bfcbc?q=80&w=300&auto=format&fit=crop', 
    'Cabello'
  ),
  (
    'Esmalte Semipermanente Glow Red', 
    'Esmalte de uñas en gel semipermanente de larga duración (hasta 21 días) en un tono rojo vibrante y de secado rápido bajo lámpara UV.', 
    18000.00, 
    100, 
    'https://images.unsplash.com/photo-1604654894610-df63bc536371?q=80&w=300&auto=format&fit=crop', 
    'Uñas'
  ),
  (
    'Aceite Hidratante para Cutículas', 
    'Aceite nutritivo a base de almendras dulces y vitamina E para fortalecer las uñas y suavizar las cutículas secas.', 
    12000.00, 
    60, 
    'https://images.unsplash.com/photo-1519014816548-bf5fe059798b?q=80&w=300&auto=format&fit=crop', 
    'Uñas'
  ),
  (
    'Paleta de Sombras Nude', 
    'Paleta profesional de 12 sombras altamente pigmentadas en tonos nude, tierra y metálicos para looks de día y de noche.', 
    75000.00, 
    25, 
    'https://images.unsplash.com/photo-1596462502278-27bfdc403348?q=80&w=300&auto=format&fit=crop', 
    'Maquillaje'
  ),
  (
    'Base de Maquillaje Matificante', 
    'Base de cobertura media-alta de larga duración con acabado mate aterciopelado. Controla el brillo e incluye FPS 15.', 
    62000.00, 
    35, 
    'https://images.unsplash.com/photo-1631730359575-38e4755d772b?q=80&w=300&auto=format&fit=crop', 
    'Maquillaje'
  ),
  (
    'Labial Líquido Mate Larga Duración', 
    'Labial líquido intransferible con acabado mate ultra cómodo. Mantiene los labios hidratados con color intenso por 16 horas.', 
    28000.00, 
    80, 
    'https://images.unsplash.com/photo-1586495777744-4413f21062fa?q=80&w=300&auto=format&fit=crop', 
    'Maquillaje'
  )
ON CONFLICT DO NOTHING;

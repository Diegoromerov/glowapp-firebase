-- backend/migrations/014_nail_search_conversion_features.sql
-- Migración para el área de Búsqueda y Conversión: Colecciones Editoriales y Gamificación

CREATE TABLE IF NOT EXISTS curated_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(255) NOT NULL,
  categoria VARCHAR(50) NOT NULL, -- nails, hair, skin, eyebrow
  query_base VARCHAR(255) NOT NULL,
  orden_visual INTEGER DEFAULT 0,
  exclusiva_streak BOOLEAN DEFAULT FALSE,
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Semilla de colecciones editoriales curadas
INSERT INTO curated_collections (nombre, categoria, query_base, orden_visual, exclusiva_streak) VALUES
-- Uñas (Nails)
('Elegancia Minimalista', 'nails', 'minimalist elegant nude nails', 1, FALSE),
('Estilo Urbano', 'nails', 'urban street style dark nails', 2, FALSE),
('Brillo Holográfico', 'nails', 'holographic glitter nail art design', 3, FALSE),
('Racha Glamour 👑', 'nails', 'luxury avant garde metallic nails aesthetic', 4, TRUE),

-- Cabello (Hair)
('Ondas Naturales', 'hair', 'beachy waves natural hair look', 1, FALSE),
('Corte Bob Moderno', 'hair', 'modern textured bob haircut', 2, FALSE),
('Racha Trenzado Real 👑', 'hair', 'intricate goddess braids hairstyle', 3, TRUE),

-- Piel (Skin)
('Efecto Dewy Glow', 'skin', 'glass skin dewy makeup routine', 1, FALSE),
('Cuidado Detox', 'skin', 'clarifying deep cleanse skin routine', 2, FALSE),
('Racha Oro Facial 👑', 'skin', 'luxury gold face mask skin spa', 3, TRUE),

-- Cejas (Eyebrow)
('Laminado Orgánico', 'eyebrow', 'fluffy feathered laminated eyebrows', 1, FALSE),
('Perfilado Clásico', 'eyebrow', 'sharp defined arched eyebrows mapping', 2, FALSE),
('Racha Cejas Perfectas 👑', 'eyebrow', 'perfect eyebrow transformation before after', 3, TRUE)
ON CONFLICT DO NOTHING;

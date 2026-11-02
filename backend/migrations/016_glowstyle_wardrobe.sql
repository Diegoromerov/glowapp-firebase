-- backend/migrations/016_glowstyle_wardrobe.sql

-- 1. Crear tabla de prendas del guardarropa
CREATE TABLE IF NOT EXISTS guardarropa_prendas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    nombre VARCHAR(100) NOT NULL,
    categoria VARCHAR(50) NOT NULL, -- 'superior', 'inferior', 'calzado', 'accesorio', 'abrigo'
    color_predominante VARCHAR(50),
    estilo_sugerido VARCHAR(50),     -- 'urbano', 'clasico', 'noche', 'fiesta', 'casual'
    image_url TEXT,                  -- Base64 data URI o URL externa
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Crear tabla de outfits recomendados / guardados
CREATE TABLE IF NOT EXISTS guardarropa_outfits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    nombre VARCHAR(100) NOT NULL,
    prendas_ids UUID[] NOT NULL,     -- Array con los IDs de las prendas combinadas
    estilo VARCHAR(50) NOT NULL,
    sugerencia_texto TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Modificaciones a la tabla usuarios para cuotas
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS glowstyle_outfits_mes INT DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS glowstyle_mes_referencia TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- 4. Inyectar datos iniciales de guardarropa simulados para el usuario de pruebas para facilitar el testeo inmediato
DO $$
DECLARE
    v_user_id INT;
BEGIN
    SELECT id INTO v_user_id FROM usuarios WHERE email = 'usuario_pruebas@gmail.com';
    
    IF v_user_id IS NOT NULL THEN
        -- Borrar prendas previas del usuario de pruebas para evitar duplicados en re-migración
        DELETE FROM guardarropa_prendas WHERE user_id = v_user_id;

        -- Insertar 4 prendas base para que la IA pueda proponer outfits desde el primer instante
        INSERT INTO guardarropa_prendas (user_id, nombre, categoria, color_predominante, estilo_sugerido, image_url)
        VALUES 
        (v_user_id, 'Blazer Sastre', 'superior', 'Negro', 'clasico', 'assets/images/design_ideas_nails_classic_1781572880027.png'),
        (v_user_id, 'Camisa de Seda', 'superior', 'Crema', 'casual', 'assets/images/design_ideas_skin_tone_1781572896303.png'),
        (v_user_id, 'Jeans Slim Fit', 'inferior', 'Azul', 'urbano', 'assets/images/design_ideas_nails_style_1781572969602.png'),
        (v_user_id, 'Botines de Cuero', 'calzado', 'Cafe', 'noche', 'assets/images/design_ideas_hair_diagnostic_1781572914936.png');
    END IF;
END $$;

-- backend/migrations/015_colorimetria_quota_and_palette.sql
-- Separación de cuota para módulo de Colorimetría y Paletas

-- 1. Añadir columnas de control de cuota de colorimetría a la tabla usuarios
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS colorimetria_diagnosticos_mes INTEGER DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS colorimetria_mes_referencia TIMESTAMPTZ DEFAULT NOW();

-- 2. Asegurarse de que el usuario de pruebas tiene su plan como premium para probar el flujo sin restricciones
UPDATE usuarios 
SET glowai_plan = 'premium' 
WHERE email = 'usuario_pruebas@gmail.com';

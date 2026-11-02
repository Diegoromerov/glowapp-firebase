-- Asegurar que la columna phone exista en usuarios
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS phone VARCHAR(20);

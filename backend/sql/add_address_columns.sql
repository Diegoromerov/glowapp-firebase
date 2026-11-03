-- =========================================================
-- Migración: Columnas estructuradas de dirección Bogotá
-- Tabla:     bookings
-- =========================================================
-- Idempotente: seguro de ejecutar múltiples veces gracias
-- a ADD COLUMN IF NOT EXISTS (requiere PostgreSQL >= 9.6).
-- =========================================================

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS tipo_via           TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS numero_via         TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS numero_placa       TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS numero_complemento TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS complemento_interior TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS barrio             TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS localidad          TEXT;

-- 065_add_business_profile_id_bookings.sql
-- Vincula cada reserva con el perfil de negocio (tenant) al que pertenece.
-- Contexto: el modelo backend/src/models/Booking.js declara business_profile_id; como Sequelize
-- incluye la columna en cada SELECT, si no existe en la base TODA consulta de Booking falla.
-- Este archivo se aplica solo: backend/index.js recorre backend/migrations/*.sql en orden alfabético
-- en cada arranque, por eso todo debe ser idempotente.
-- Sin FK explícita a business_profiles(id): esa tabla se crea desde src/db/migrations/012 y no en
-- todos los entornos existe al momento de aplicar este archivo.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS business_profile_id VARCHAR(36);

CREATE INDEX IF NOT EXISTS idx_bookings_business_profile
  ON bookings(business_profile_id);

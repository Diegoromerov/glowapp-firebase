-- Dependencias de 007 + las columnas que el controlador consulta de usuarios.
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY,
  rol VARCHAR(20),
  nombre TEXT,
  email TEXT,
  phone TEXT
);
CREATE TABLE IF NOT EXISTS bookings (id UUID PRIMARY KEY);

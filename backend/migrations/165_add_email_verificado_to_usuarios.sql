-- La base de staging/prod omite el bootstrap legado (<131), pero los flujos
-- de autenticación y autorización de retiros dependen de esta marca.
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS email_verificado BOOLEAN NOT NULL DEFAULT FALSE;

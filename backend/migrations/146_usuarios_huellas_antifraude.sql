-- 146_usuarios_huellas_antifraude.sql
--
-- Huellas del registro para el antifraude del programa de referidos (F3).
--
-- Sin esto no hay regla posible: la única defensa era "no te invites a ti mismo".
-- Con el hash de IP y de dispositivo se puede detectar que la invitada comparte
-- origen con quien la invita, que es el patrón de una granja de cuentas.
--
-- Se guarda el HASH, nunca la IP ni el user-agent en claro.
--
-- Nulas a propósito: las cuentas anteriores no tienen el dato y no se puede
-- inventar. Una huella nula nunca coincide con otra.

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ip_hash TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS device_hash TEXT;

-- La comparación que hace el servicio es de igualdad por huella.
CREATE INDEX IF NOT EXISTS usuarios_ip_hash
    ON usuarios (ip_hash) WHERE ip_hash IS NOT NULL;

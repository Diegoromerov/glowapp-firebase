-- 087_add_provider_rut_responsibility.sql
--
-- Contexto: hallazgo W13 de `.hermes/REVISAR.md` y el diseño en
-- `.hermes/plans/2026-10-10_captura-responsabilidad-iva-onboarding.md`.
--
-- Hasta ahora `usuarios.responsable_iva` valía `true` para TODOS por decisión de
-- negocio (migración 086), pero nadie había declarado nada. La responsabilidad de
-- IVA no depende del servicio —el art. 476 sólo dice que los tratamientos de
-- belleza están gravados— sino de los ingresos del prestador (art. 437 par. 3
-- E.T.), y consta en su RUT: código 48 = responsable de IVA, 49 = no responsable.
--
-- Decisiones tomadas (Diego, 2026-10-10):
--   D1 — `responsable_iva` se DERIVA del código del RUT. Un override manual manda
--        sobre la derivación y queda auditado (fuente 'MANUAL').
--   D2 — El número de RUT es obligatorio para poder declarar.
--   D3 — Declarar es opcional para publicar y OBLIGATORIO para recibir pagos con
--        IVA. Consecuencia: quien no ha declarado NO se presume responsable.
--
-- CAMBIO DE COMPORTAMIENTO DELIBERADO (leer antes de aplicar): el UPDATE del
-- final pone `responsable_iva = false` a quien no ha declarado. Esto NO cambia lo
-- que paga ningún cliente —el precio publicado es el precio final al consumidor y
-- el IVA se discrimina, no se suma— sólo deja de desglosarse un IVA que el
-- prestador no ha acreditado. Es reversible: en cuanto declare su código, la
-- responsabilidad se recalcula.
--
-- Idempotente: el runner aplica este archivo a producción al desplegar.

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS rut_numero                        VARCHAR(20),
  ADD COLUMN IF NOT EXISTS rut_responsabilidad_codigo        SMALLINT,
  ADD COLUMN IF NOT EXISTS responsable_iva_override           BOOLEAN,
  ADD COLUMN IF NOT EXISTS responsabilidad_iva_fuente         VARCHAR(10),
  ADD COLUMN IF NOT EXISTS responsabilidad_iva_actualizada_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS responsabilidad_iva_cambiada_por   INTEGER;

DO $$
BEGIN
  -- Sólo 48 (responsable) o 49 (no responsable); NULL = sin declarar.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_usuarios_rut_responsabilidad') THEN
    ALTER TABLE usuarios
      ADD CONSTRAINT chk_usuarios_rut_responsabilidad
      CHECK (rut_responsabilidad_codigo IS NULL OR rut_responsabilidad_codigo IN (48, 49));
  END IF;

  -- Procedencia del valor: derivado del RUT o puesto a mano (auditado).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_usuarios_responsabilidad_fuente') THEN
    ALTER TABLE usuarios
      ADD CONSTRAINT chk_usuarios_responsabilidad_fuente
      CHECK (responsabilidad_iva_fuente IS NULL OR responsabilidad_iva_fuente IN ('RUT', 'MANUAL'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_usuarios_responsabilidad_cambiada_por') THEN
    ALTER TABLE usuarios
      ADD CONSTRAINT fk_usuarios_responsabilidad_cambiada_por
      FOREIGN KEY (responsabilidad_iva_cambiada_por) REFERENCES usuarios(id) ON DELETE SET NULL;
  END IF;
END $$;

-- D3: sin declaración no se presume responsable de IVA.
-- El guardia `fuente IS DISTINCT FROM 'MANUAL'` evita pisar un override que un
-- admin haya puesto a mano.
UPDATE usuarios
   SET responsable_iva = false
 WHERE rut_responsabilidad_codigo IS NULL
   AND responsable_iva_override IS NULL
   AND responsabilidad_iva_fuente IS DISTINCT FROM 'MANUAL';

-- Y quien SÍ ha declarado, sin override, sigue su código del RUT. Hoy no hay
-- ninguna fila en ese estado, pero así la migración es completa y correcta
-- aunque se aplique a una base con declaraciones a medias.
UPDATE usuarios
   SET responsable_iva = (rut_responsabilidad_codigo = 48)
 WHERE rut_responsabilidad_codigo IN (48, 49)
   AND responsable_iva_override IS NULL;

-- Y quien tiene un override, sigue el override: `responsable_iva` es la función
-- de (override, código) y tiene que quedar sincronizada en los TRES casos:
-- override, código declarado, y sin declarar. Sin esta rama, una fila con
-- override puesto quedaría con un `responsable_iva` desincronizado.
UPDATE usuarios
   SET responsable_iva = responsable_iva_override
 WHERE responsable_iva_override IS NOT NULL;

-- Para el filtro «sin verificar» del panel admin (fase 4).
CREATE INDEX IF NOT EXISTS idx_usuarios_responsabilidad_sin_declarar
  ON usuarios (responsable_iva)
  WHERE rut_responsabilidad_codigo IS NULL AND responsable_iva_override IS NULL;

COMMENT ON COLUMN usuarios.rut_numero IS
  'Número de RUT/NIT del prestador. Obligatorio para declarar la responsabilidad de IVA (D2).';
COMMENT ON COLUMN usuarios.rut_responsabilidad_codigo IS
  'Casilla de responsabilidades del RUT: 48 = responsable de IVA, 49 = no responsable. NULL = sin declarar.';
COMMENT ON COLUMN usuarios.responsable_iva_override IS
  'Override manual auditado (D1). Cuando está definido manda sobre la derivación del RUT.';
COMMENT ON COLUMN usuarios.responsabilidad_iva_fuente IS
  'De dónde salió el valor vigente: RUT (derivado) o MANUAL (override). NULL = sin declarar.';
COMMENT ON COLUMN usuarios.responsabilidad_iva_actualizada_at IS
  'Cuándo se declaró o cambió la responsabilidad de IVA.';
COMMENT ON COLUMN usuarios.responsabilidad_iva_cambiada_por IS
  'Quién la declaró o cambió (usuario que hizo la petición).';

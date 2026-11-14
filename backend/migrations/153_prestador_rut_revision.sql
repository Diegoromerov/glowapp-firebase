-- 153_prestador_rut_revision.sql
--
-- Fase 1 de D-GL-030 (IVA del prestador por hechos verificables, no por switch).
--
-- QUÉ FALTABA: las migraciones 086/087 ya guardan el número de RUT y el código de
-- responsabilidad (48/49), y `ivaPrestador` deriva `responsable_iva` de ahí. Pero
-- no hay rastro del DOCUMENTO ni de quién lo miró: el prestador podía declarar un
-- código sin subir nada y nadie lo contrastaba. La DIAN no ofrece consulta
-- automatizable (el servicio de MUISCA exige captcha y sesión), así que la
-- verificación es humana: alguien del equipo abre el RUT y lo aprueba o rechaza.
--
-- DECISIÓN (Diego, 2026-11-14): el RUT es OBLIGATORIO para publicar servicios y
-- la revisión la hace el equipo. Esto cambia D3 de 087 ("declarar es opcional
-- para publicar"): ahora publicar exige RUT cargado Y aprobado.
--
-- El estado de la declaración fiscal NO se aplica solo: `responsable_iva` sigue
-- derivándose del código, pero sólo cuando la revisión queda APROBADA. Mientras
-- esté PENDIENTE o RECHAZADA, el prestador no publica (ver
-- `src/services/fiscalRevision.js`).
--
-- Idempotente: el runner aplica este archivo en cada despliegue.

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS rut_soporte_url   TEXT,
  ADD COLUMN IF NOT EXISTS rut_soporte_hash  VARCHAR(64),
  ADD COLUMN IF NOT EXISTS rut_soporte_mime  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS rut_soporte_bytes INTEGER,
  ADD COLUMN IF NOT EXISTS rut_cargado_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revision_estado   VARCHAR(12) NOT NULL DEFAULT 'SIN_ENVIAR',
  ADD COLUMN IF NOT EXISTS revision_nota     TEXT,
  ADD COLUMN IF NOT EXISTS revisado_por      INTEGER,
  ADD COLUMN IF NOT EXISTS revisado_at       TIMESTAMPTZ;

DO $$
BEGIN
  -- Ciclo de vida del documento. SIN_ENVIAR es el estado de todo el mundo hasta
  -- que sube el RUT; no se permite NULL para que la cola del equipo no tenga que
  -- tratar dos ausencias distintas.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_usuarios_revision_estado') THEN
    ALTER TABLE usuarios
      ADD CONSTRAINT chk_usuarios_revision_estado
      CHECK (revision_estado IN ('SIN_ENVIAR', 'PENDIENTE', 'APROBADA', 'RECHAZADA'));
  END IF;

  -- Un soporte cargado siempre trae hash: es la prueba de que el archivo que se
  -- revisó es el mismo que quedó almacenado.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_usuarios_rut_soporte_hash') THEN
    ALTER TABLE usuarios
      ADD CONSTRAINT chk_usuarios_rut_soporte_hash
      CHECK (rut_soporte_url IS NULL OR rut_soporte_hash ~ '^[a-f0-9]{64}$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_usuarios_revisado_por') THEN
    ALTER TABLE usuarios
      ADD CONSTRAINT fk_usuarios_revisado_por
      FOREIGN KEY (revisado_por) REFERENCES usuarios(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Cola de revisión: el panel pide "pendientes" ordenados por antigüedad.
CREATE INDEX IF NOT EXISTS idx_usuarios_revision_pendiente
  ON usuarios (rut_cargado_at)
  WHERE revision_estado = 'PENDIENTE';

COMMENT ON COLUMN usuarios.rut_soporte_url IS
  'URL del RUT cargado por el prestador (PDF o imagen). Obligatorio para publicar servicios (D-GL-030).';
COMMENT ON COLUMN usuarios.rut_soporte_hash IS
  'SHA-256 del archivo revisado. Prueba de que el soporte no cambió después de la aprobación.';
COMMENT ON COLUMN usuarios.rut_soporte_mime IS
  'Tipo MIME del soporte: application/pdf, image/jpeg o image/png.';
COMMENT ON COLUMN usuarios.rut_soporte_bytes IS
  'Tamaño del soporte en bytes (límite 10 MB en la validación de la app).';
COMMENT ON COLUMN usuarios.rut_cargado_at IS
  'Cuándo subió el prestador el RUT que está en revisión.';
COMMENT ON COLUMN usuarios.revision_estado IS
  'Ciclo del documento: SIN_ENVIAR → PENDIENTE → APROBADA | RECHAZADA (reenviable). Sin APROBADA no se publican servicios.';
COMMENT ON COLUMN usuarios.revision_nota IS
  'Motivo del rechazo o nota del revisor. Obligatorio al rechazar.';
COMMENT ON COLUMN usuarios.revisado_por IS
  'Usuario del equipo que aprobó o rechazó el RUT.';
COMMENT ON COLUMN usuarios.revisado_at IS
  'Cuándo se revisó el soporte.';

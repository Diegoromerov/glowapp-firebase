-- Keep the currently approved fiscal data effective while a replacement RUT is reviewed.
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS rut_solicitado_numero VARCHAR(20),
  ADD COLUMN IF NOT EXISTS rut_solicitado_responsabilidad_codigo SMALLINT,
  ADD COLUMN IF NOT EXISTS rut_solicitado_soporte_url TEXT,
  ADD COLUMN IF NOT EXISTS rut_solicitado_soporte_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS rut_solicitado_soporte_mime VARCHAR(100),
  ADD COLUMN IF NOT EXISTS rut_solicitado_soporte_bytes INTEGER;

CREATE TABLE IF NOT EXISTS provider_fiscal_change_requests (
  id BIGSERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  rut_anterior VARCHAR(20),
  codigo_anterior SMALLINT,
  soporte_hash_anterior VARCHAR(64),
  rut_solicitado VARCHAR(20) NOT NULL,
  codigo_solicitado SMALLINT NOT NULL CHECK (codigo_solicitado IN (48, 49)),
  soporte_hash_solicitado VARCHAR(64) NOT NULL,
  estado VARCHAR(12) NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado IN ('PENDIENTE', 'APROBADA', 'RECHAZADA')),
  solicitado_por INTEGER NOT NULL REFERENCES usuarios(id),
  solicitado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revisado_por INTEGER REFERENCES usuarios(id),
  revisado_at TIMESTAMPTZ,
  nota_revision TEXT
);

CREATE INDEX IF NOT EXISTS idx_provider_fiscal_change_requests_pending
  ON provider_fiscal_change_requests (solicitado_at)
  WHERE estado = 'PENDIENTE';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_usuarios_rut_solicitado_codigo') THEN
    ALTER TABLE usuarios
      ADD CONSTRAINT chk_usuarios_rut_solicitado_codigo
      CHECK (rut_solicitado_responsabilidad_codigo IS NULL OR rut_solicitado_responsabilidad_codigo IN (48, 49));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_usuarios_rut_solicitado_hash') THEN
    ALTER TABLE usuarios
      ADD CONSTRAINT chk_usuarios_rut_solicitado_hash
      CHECK (rut_solicitado_soporte_hash IS NULL OR rut_solicitado_soporte_hash ~ '^[a-f0-9]{64}$');
  END IF;
END $$;

-- Older versions stored an unreviewed submission in the effective columns.
UPDATE usuarios
   SET rut_solicitado_numero = rut_numero,
       rut_solicitado_responsabilidad_codigo = rut_responsabilidad_codigo,
       rut_solicitado_soporte_url = rut_soporte_url,
       rut_solicitado_soporte_hash = rut_soporte_hash,
       rut_solicitado_soporte_mime = rut_soporte_mime,
       rut_solicitado_soporte_bytes = rut_soporte_bytes
 WHERE revision_estado IN ('PENDIENTE', 'RECHAZADA')
   AND rut_solicitado_numero IS NULL;

COMMENT ON COLUMN usuarios.rut_solicitado_numero IS
  'RUT nuevo en revisión. El RUT efectivo no cambia hasta la aprobación administrativa.';
COMMENT ON COLUMN usuarios.rut_solicitado_responsabilidad_codigo IS
  'Responsabilidad de IVA solicitada. El código efectivo no cambia hasta la aprobación administrativa.';

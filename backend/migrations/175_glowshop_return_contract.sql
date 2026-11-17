-- 175_glowshop_return_contract.sql
-- Persist the return contract consumed by the client and provider apps.
ALTER TABLE devoluciones
  ADD COLUMN IF NOT EXISTS items JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS aprobada_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS aprobada_por INTEGER REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS rechazada_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rechazada_por INTEGER REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS rechazo_motivo TEXT;

-- Metrics migration 173 references generic lifecycle timestamps not present in
-- the canonical return schema (163). Supply compatible aliases for its rollup.
ALTER TABLE devoluciones
  ADD COLUMN IF NOT EXISTS creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMPTZ;

UPDATE devoluciones
   SET creado_en = COALESCE(solicitada_en, NOW()),
       actualizado_en = COALESCE(solicitada_en, NOW())
 WHERE creado_en > COALESCE(solicitada_en, NOW())
    OR actualizado_en IS NULL;

UPDATE devoluciones SET actualizado_en = COALESCE(actualizado_en, solicitada_en, NOW())
 WHERE actualizado_en IS NULL;

UPDATE devoluciones SET creado_en = COALESCE(solicitada_en, NOW())
 WHERE creado_en IS DISTINCT FROM COALESCE(solicitada_en, NOW());

CREATE INDEX IF NOT EXISTS idx_devoluciones_receptor_estado
  ON devoluciones(receptor_id, estado, solicitada_en DESC);

CREATE OR REPLACE FUNCTION glowshop_sync_return_timestamps()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en := NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_glowshop_sync_return_timestamps ON devoluciones;
CREATE TRIGGER trg_glowshop_sync_return_timestamps
  BEFORE UPDATE ON devoluciones
  FOR EACH ROW EXECUTE FUNCTION glowshop_sync_return_timestamps();

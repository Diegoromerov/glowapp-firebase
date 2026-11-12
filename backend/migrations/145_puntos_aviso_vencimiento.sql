-- 145_puntos_aviso_vencimiento.sql
--
-- Marca de aviso enviado para los lotes que están por vencer.
--
-- Sin esta columna el job no puede saber qué ya avisó, y avisaría todos los días
-- durante un mes: la usuaria bloquearía las notificaciones justo cuando el aviso
-- importa. Se marca por lote, no por usuaria, porque cada lote vence en su fecha.

ALTER TABLE points_lots
  ADD COLUMN IF NOT EXISTS aviso_vencimiento_en TIMESTAMPTZ;

-- El job busca justo esto: lotes con saldo, sin aviso y que vencen pronto.
CREATE INDEX IF NOT EXISTS points_lots_por_avisar
    ON points_lots (vence_en)
    WHERE puntos_restantes > 0 AND aviso_vencimiento_en IS NULL;

COMMENT ON COLUMN points_lots.aviso_vencimiento_en IS
  'Cuándo se avisó a la usuaria que este lote vence; NULL si nunca se avisó';

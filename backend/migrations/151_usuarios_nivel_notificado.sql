-- 151_usuarios_nivel_notificado.sql
--
-- El nivel se calcula al vuelo desde `xp_logs` (a propósito: no hay niveles
-- desincronizados). Consecuencia: no existe el momento «subió de nivel» y no hay
-- dónde enganchar el aviso.
--
-- Esta columna guarda el último nivel del que se le avisó a la usuaria. Sirve
-- para dos cosas: no repetir el aviso desde el punto único de XP, y que el job
-- diario detecte subidas escritas por fuera de ese camino.
--
-- Aditiva e idempotente.

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ultimo_nivel_notificado TEXT;

COMMENT ON COLUMN usuarios.ultimo_nivel_notificado IS
  'Último nivel (glow/petalo/oro/diamante) del que se notificó a la usuaria.';

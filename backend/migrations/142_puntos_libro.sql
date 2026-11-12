-- 142_puntos_libro.sql
--
-- El libro del DINERO del programa, separado del libro del ESTADO.
--
-- Decisión D-01 (aprobada 2026-11-12): `xp_logs` sigue siendo el historial de XP
-- de nivel (compartires, insignias, gamificación) y no se le añaden columnas ni
-- se le reescribe. El fondo de puntos canjeables vive aquí, con tres cosas que
-- `xp_logs` no puede dar:
--
--   1. vencimiento por acreditación (12 meses), sin el cual el pasivo crece sin
--      techo y no se puede provisionar;
--   2. idempotencia por pedido: un webhook repetido no puede acreditar dos veces;
--   3. una clave por movimiento, para que el compromiso en un pedido y su
--      consumo no se dupliquen cuando el cliente reintenta.
--
-- El modelo, en una frase: cada acreditación crea un LOTE con su fecha de
-- vencimiento; el saldo es la suma de los restos vigentes; comprometer descuenta
-- del lote que vence antes (FEFO) sin gastar; consumir convierte la espera en
-- gasto cuando el pedido se paga; liberar devuelve lo comprometido si el pedido
-- se cae.
--
-- Sin `tenant_id` y sin RLS a propósito: igual que `xp_logs`, estos datos son de
-- la persona, no del negocio, y todas las consultas van filtradas por el
-- `user_id` que sale del token.

CREATE TABLE IF NOT EXISTS points_lots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    -- `puntos` es el tamaño original del lote y no cambia nunca: sirve de techo
    -- para que una liberación no lo reviva más allá de lo que se acreditó.
    puntos INTEGER NOT NULL CHECK (puntos > 0),
    puntos_restantes INTEGER NOT NULL CHECK (puntos_restantes >= 0 AND puntos_restantes <= puntos),
    origen VARCHAR(40) NOT NULL,
    -- Pedido (UUID como texto) o id del `xp_logs` histórico en el backfill.
    referencia_id TEXT,
    motivo VARCHAR(255),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    vence_en TIMESTAMPTZ NOT NULL,
    CONSTRAINT points_lots_vence_despues_creado CHECK (vence_en > creado_en)
);

-- Una compra referida acredita UNA vez. La restricción vive en la base, no en el
-- código: un webhook repetido no puede acreditar dos veces ni con una carrera.
CREATE UNIQUE INDEX IF NOT EXISTS points_lots_origen_referencia
    ON points_lots (origen, referencia_id)
    WHERE referencia_id IS NOT NULL;

-- Saldo y consumo FEFO: por persona, ordenado por lo que vence antes.
CREATE INDEX IF NOT EXISTS points_lots_saldo
    ON points_lots (user_id, vence_en);

CREATE TABLE IF NOT EXISTS points_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lot_id UUID NOT NULL REFERENCES points_lots(id) ON DELETE RESTRICT,
    user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    pedido_id UUID REFERENCES pedidos_tienda(id) ON DELETE SET NULL,
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN (
        'compromiso', 'consumo', 'liberacion', 'reversion', 'vencimiento', 'ajuste'
    )),
    -- Siempre positivo: el signo lo pone el `tipo`, no el número. Con un campo
    -- con signo, un `-300` en una liberación pasaba inadvertido.
    --   compromiso   resta al lote (los puntos salen del saldo disponible)
    --   consumo      no mueve saldo: la espera se vuelve gasto
    --   liberacion   suma al lote (pedido cancelado o vencido a las 24 h)
    --   reversion    suma al lote de origen (reembolso del pedido que premió)
    --   vencimiento  resta hasta cero (sólo reporte; el saldo ya lo excluye)
    --   ajuste       corrección manual con motivo
    puntos INTEGER NOT NULL CHECK (puntos > 0),
    -- Idempotencia fila por fila. No puede ser UNIQUE(pedido_id, tipo): un canje
    -- puede tocar dos lotes y entonces hay dos compromisos del mismo pedido.
    clave VARCHAR(120) NOT NULL UNIQUE,
    motivo VARCHAR(255),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS points_movements_pedido
    ON points_movements (pedido_id, tipo);

CREATE INDEX IF NOT EXISTS points_movements_usuario
    ON points_movements (user_id, creado_en DESC);

-- El vencimiento de un lote se registra una sola vez.
CREATE UNIQUE INDEX IF NOT EXISTS points_movements_vencimiento_unico
    ON points_movements (lot_id)
    WHERE tipo = 'vencimiento';

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Los 500 puntos que ya se acreditaron al referente viven en `xp_logs` con
-- reason 'referido:compra'. Se convierten en lotes para que nadie pierda saldo al
-- cambiar de libro. Las filas de `xp_logs` NO se borran: siguen sumando XP.
--
-- Sólo las acreditaciones positivas: los asientos negativos del viejo canje a
-- cashback no son premios y no deben convertirse en saldo.
--
-- `xp_logs` se comprueba antes de tocarla: la lista de arranque de
-- `prepareRlsDatabase.js` no crea esa tabla (la 023 no está en ella), y una
-- migración que asume su existencia deja la cadena en rojo con
-- «relation "xp_logs" does not exist». En producción sí existe y el backfill
-- corre; en una base nueva no hay nada que migrar.
DO $$
BEGIN
  IF to_regclass('public.xp_logs') IS NOT NULL THEN
    INSERT INTO points_lots
        (user_id, puntos, puntos_restantes, origen, referencia_id, motivo, creado_en, vence_en)
    SELECT user_id,
           xp_amount,
           xp_amount,
           'referido:compra:legacy',
           id::text,
           'Premio de referidos (histórico)',
           COALESCE(created_at, NOW()),
           COALESCE(created_at, NOW()) + INTERVAL '12 months'
      FROM xp_logs
     WHERE reason = 'referido:compra'
       AND xp_amount > 0
    ON CONFLICT (origen, referencia_id) WHERE referencia_id IS NOT NULL DO NOTHING;
  END IF;
END $$;

COMMENT ON TABLE points_lots IS
  'Acreditaciones del fondo de puntos canjeable, con vencimiento y saldo restante';
COMMENT ON TABLE points_movements IS
  'Movimientos del fondo: compromiso, consumo, liberación, reversión, vencimiento y ajuste';

-- 081_pqrsf_sla_y_autor.sql
--
-- Cimiento de PQRSF en el panel: tiempos de respuesta EXPLÍCITOS y autor de cada
-- mensaje.
--
-- PROBLEMA
--   `007_soporte_y_pqrsf.sql` dejó el hilo en `ticket_mensajes` con un único dato
--   de tiempo (`fecha_envio`), así que hoy:
--     · el "tiempo de primera respuesta" solo existe como MIN(fecha_envio) de los
--       mensajes cruzados contra `usuarios.rol` — una consulta frágil que hay que
--       reescribir en cada métrica, y que no puede distinguir un operador humano de
--       un agente;
--     · no se registra CUÁNDO pasó un ticket a RESUELTO/CERRADO, solo cuándo se
--       tocó por última vez;
--     · no hay forma de saber quién escribió un mensaje (¿la persona o el sistema?),
--       que es justo la costura que hace falta para que un agente responda.
--
-- QUÉ AÑADE
--   tickets.primera_respuesta_en   primer mensaje de OPERADOR/AGENTE (no del usuario)
--   tickets.resuelto_en            cuándo pasó a RESUELTO
--   tickets.cerrado_en             cuándo pasó a CERRADO
--   ticket_mensajes.autor_tipo     USUARIO | OPERADOR | AGENTE
--   ticket_mensajes.es_borrador    un borrador de agente NO se ha enviado todavía
--
-- IDEMPOTENTE, a propósito: el runner re-aplica todo lo que no esté registrado en
-- `schema_migrations` (una migración que falla NO se registra y se reintenta en cada
-- arranque), así que todo va con IF NOT EXISTS y cada backfill con `IS NULL`.
--
-- NO toca `estado` ni sus CHECK: los valores válidos son los de 007
-- (ABIERTO, EN_PROCESO, ESPERANDO_RESPUESTA_USUARIO, RESUELTO, CERRADO).

-- ── Columnas ───────────────────────────────────────────────────────────────────
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS primera_respuesta_en TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resuelto_en TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS cerrado_en TIMESTAMPTZ;

ALTER TABLE ticket_mensajes ADD COLUMN IF NOT EXISTS autor_tipo VARCHAR(10);
ALTER TABLE ticket_mensajes ADD COLUMN IF NOT EXISTS es_borrador BOOLEAN NOT NULL DEFAULT FALSE;

-- ADD CONSTRAINT no admite IF NOT EXISTS: se comprueba por catálogo. Se permite NULL
-- para no romper filas históricas si algún día se escribe sin autor declarado.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ticket_mensajes_autor_tipo_check'
  ) THEN
    ALTER TABLE ticket_mensajes
      ADD CONSTRAINT ticket_mensajes_autor_tipo_check
      CHECK (autor_tipo IS NULL OR autor_tipo IN ('USUARIO', 'OPERADOR', 'AGENTE'));
  END IF;
END $$;

-- ── Backfill ───────────────────────────────────────────────────────────────────
-- El autor de lo ya existente se deduce del rol del remitente. `toApiRole` mapea
-- 'ADMIN' → 'admin', así que aquí se compara el valor CRUDO de la base.
UPDATE ticket_mensajes m
   SET autor_tipo = CASE WHEN u.rol = 'ADMIN' THEN 'OPERADOR' ELSE 'USUARIO' END
  FROM usuarios u
 WHERE u.id = m.remitente_id
   AND m.autor_tipo IS NULL;

-- Mensajes cuyo remitente no se puede resolver: se asume USUARIO. Nunca OPERADOR:
-- atribuir a un operador un mensaje que no lo es INFLARÍA las métricas de respuesta.
UPDATE ticket_mensajes SET autor_tipo = 'USUARIO' WHERE autor_tipo IS NULL;

-- Primera respuesta = primer mensaje de operador o agente (los borradores no cuentan:
-- no se han enviado).
UPDATE tickets t
   SET primera_respuesta_en = r.primera
  FROM (
    SELECT ticket_id, MIN(fecha_envio) AS primera
      FROM ticket_mensajes
     WHERE autor_tipo IN ('OPERADOR', 'AGENTE')
       AND es_borrador = FALSE
     GROUP BY ticket_id
  ) r
 WHERE r.ticket_id = t.id
   AND t.primera_respuesta_en IS NULL;

-- APROXIMACIÓN declarada, no dato exacto: para los tickets ya resueltos/cerrados antes
-- de esta migración no existe registro de cuándo cambiaron de estado, así que se usa
-- `fecha_actualizacion`. Desde ahora lo escribe el código con precisión.
UPDATE tickets SET resuelto_en = fecha_actualizacion
 WHERE estado = 'RESUELTO' AND resuelto_en IS NULL;
UPDATE tickets SET cerrado_en = fecha_actualizacion
 WHERE estado = 'CERRADO' AND cerrado_en IS NULL;

-- ── Índices para la bandeja (filtros por estado/prioridad y orden por SLA) ──────
CREATE INDEX IF NOT EXISTS idx_tickets_estado_prioridad ON tickets (estado, prioridad);
CREATE INDEX IF NOT EXISTS idx_tickets_primera_respuesta ON tickets (primera_respuesta_en);
CREATE INDEX IF NOT EXISTS idx_ticket_mensajes_ticket_fecha ON ticket_mensajes (ticket_id, fecha_envio);

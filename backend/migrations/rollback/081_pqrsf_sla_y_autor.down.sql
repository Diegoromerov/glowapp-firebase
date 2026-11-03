-- 081_pqrsf_sla_y_autor.down.sql
--
-- Revierte 081. OJO: este rollback PIERDE DATOS que no se pueden reconstruir —
-- `primera_respuesta_en`, `resuelto_en` y `cerrado_en` se derivaron de datos que sí
-- siguen existiendo (se pueden recalcular), pero los que escriba el código desde
-- ahora (respuestas y resoluciones nuevas) se pierden al dropear las columnas.
-- Los `ticket_mensajes` NO se tocan: la conversación es intocable.

DROP INDEX IF EXISTS idx_ticket_mensajes_ticket_fecha;
DROP INDEX IF EXISTS idx_tickets_primera_respuesta;
DROP INDEX IF EXISTS idx_tickets_estado_prioridad;

ALTER TABLE ticket_mensajes DROP CONSTRAINT IF EXISTS ticket_mensajes_autor_tipo_check;
ALTER TABLE ticket_mensajes DROP COLUMN IF EXISTS es_borrador;
ALTER TABLE ticket_mensajes DROP COLUMN IF EXISTS autor_tipo;

ALTER TABLE tickets DROP COLUMN IF EXISTS cerrado_en;
ALTER TABLE tickets DROP COLUMN IF EXISTS resuelto_en;
ALTER TABLE tickets DROP COLUMN IF EXISTS primera_respuesta_en;

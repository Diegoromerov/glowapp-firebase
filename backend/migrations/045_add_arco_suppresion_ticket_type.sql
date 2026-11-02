-- backend/migrations/045_add_arco_suppresion_ticket_type.sql
-- Agregar tipo ARCO_SUPRESION a la tabla tickets para solicitudes de supresión de datos (Ley 1581/2012)
-- Referencia: Fase 3 - Solicitar Supresión de Datos (ARCO)

-- Verificar si la tabla usa ENUM o CHECK constraint para el campo tipo
-- Basado en 007_soporte_y_pqrsf.sql, usa CHECK constraint

-- Agregar nuevo valor al CHECK constraint de tipo
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_tipo_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_tipo_check 
    CHECK (tipo IN ('PETICION', 'QUEJA', 'RECLAMO', 'SUGERENCIA', 'FELICITACION', 'ARCO_SUPRESION'));

-- Comentario para documentación
COMMENT ON CONSTRAINT tickets_tipo_check ON tickets IS 'Tipos de ticket válidos. ARCO_SUPRESION: Solicitud de supresión de datos bajo Ley 1581/2012 Art. 15';
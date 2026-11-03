-- c:\beauty-app\backend\migrations\007_soporte_y_pqrsf.sql

CREATE TABLE IF NOT EXISTS tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
    tipo VARCHAR(50) NOT NULL CHECK (tipo IN ('PETICION', 'QUEJA', 'RECLAMO', 'SUGERENCIA', 'FELICITACION')),
    categoria VARCHAR(50) NOT NULL CHECK (categoria IN ('pago', 'servicio', 'app', 'seguridad', 'otros')),
    asunto VARCHAR(255) NOT NULL,
    descripcion TEXT NOT NULL,
    estado VARCHAR(50) NOT NULL DEFAULT 'ABIERTO' CHECK (estado IN ('ABIERTO', 'EN_PROCESO', 'ESPERANDO_RESPUESTA_USUARIO', 'RESUELTO', 'CERRADO')),
    prioridad VARCHAR(50) NOT NULL DEFAULT 'MEDIA' CHECK (prioridad IN ('BAJA', 'MEDIA', 'ALTA', 'EMERGENCIA')),
    evidencia_urls TEXT[] DEFAULT '{}',
    fecha_creacion TIMESTAMPTZ DEFAULT NOW(),
    fecha_actualizacion TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ticket_mensajes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    remitente_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    mensaje TEXT NOT NULL,
    fecha_envio TIMESTAMPTZ DEFAULT NOW()
);

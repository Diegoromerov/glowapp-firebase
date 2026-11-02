-- Datos para ejercitar los endpoints reales. Fechas RELATIVAS a NOW() porque el SLA se
-- mide contra el reloj real; los asertos usan rangos, no valores exactos.
INSERT INTO usuarios (id, rol, nombre, email) VALUES
 (1,'CLIENTE','Ana Cliente','ana@ejemplo.test'),
 (2,'ADMIN','Operador Uno','operador@ejemplo.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tickets (id, usuario_id, tipo, categoria, asunto, descripcion, estado, prioridad, fecha_creacion, fecha_actualizacion) VALUES
 ('11111111-1111-1111-1111-111111111111',1,'RECLAMO','pago','t1 emergencia sin responder','x','ABIERTO','EMERGENCIA', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '3 hours'),
 ('22222222-2222-2222-2222-222222222222',1,'PETICION','servicio','t2 alta respondida a tiempo','x','ESPERANDO_RESPUESTA_USUARIO','ALTA', NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '10 minutes'),
 ('33333333-3333-3333-3333-333333333333',1,'QUEJA','app','t3 baja sin responder','x','ABIERTO','BAJA', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '3 hours'),
 ('44444444-4444-4444-4444-444444444444',1,'ARCO_SUPRESION','seguridad','t4 arco sin responder','x','ABIERTO','MEDIA', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour'),
 ('55555555-5555-5555-5555-555555555555',1,'SUGERENCIA','otros','t5 alta sin responder','x','ABIERTO','ALTA', NOW() - INTERVAL '5 hours', NOW() - INTERVAL '5 hours');

INSERT INTO ticket_mensajes (ticket_id, remitente_id, mensaje, autor_tipo, fecha_envio) VALUES
 ('11111111-1111-1111-1111-111111111111',1,'abro el reclamo','USUARIO', NOW() - INTERVAL '3 hours'),
 ('22222222-2222-2222-2222-222222222222',1,'abro la peticion','USUARIO', NOW() - INTERVAL '30 minutes'),
 ('22222222-2222-2222-2222-222222222222',2,'respuesta del operador','OPERADOR', NOW() - INTERVAL '10 minutes'),
 ('33333333-3333-3333-3333-333333333333',1,'abro la queja','USUARIO', NOW() - INTERVAL '3 hours');

-- primera_respuesta_en de t2, como lo habria dejado el flujo del usuario
UPDATE tickets SET primera_respuesta_en = NOW() - INTERVAL '10 minutes'
 WHERE id = '22222222-2222-2222-2222-222222222222';

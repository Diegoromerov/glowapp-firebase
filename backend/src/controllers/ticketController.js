// backend/src/controllers/ticketController.js
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');
const { motivoInvalido } = require('../utils/ticketEsquema');

// POST /api/tickets -> Crear un nuevo ticket
exports.createTicket = async (req, res) => {
  try {
    const usuario_id = req.user.id;
    const { booking_id, tipo, categoria, asunto, descripcion, evidencia_urls, prioridad } = req.body;

    if (!tipo || !categoria || !asunto || !descripcion) {
      return res.status(400).json({ error: 'tipo, categoria, asunto y descripcion son campos obligatorios.' });
    }

    if (typeof asunto !== 'string' || asunto.trim().length > 255
        || typeof descripcion !== 'string' || descripcion.trim().length < 10 || descripcion.trim().length > 10000) {
      return res.status(400).json({ error: 'FORMATO_INVALIDO', message: 'El asunto admite hasta 255 caracteres y la descripción debe tener entre 10 y 10.000.' });
    }
    if (prioridad !== undefined) {
      return res.status(400).json({ error: 'PRIORIDAD_NO_EDITABLE', message: 'La prioridad la asigna el equipo de soporte.' });
    }
    if (booking_id) {
      const bookingRef = /^(?:[0-9]{1,20}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
      if (typeof booking_id !== 'string' || !bookingRef.test(booking_id)) return res.status(400).json({ error: 'CITA_INVALIDA', message: 'El identificador de cita no tiene un formato admitido.' });
      const belongs = await sequelize.query(
        `SELECT id FROM bookings WHERE id::text = :booking_id AND (client_id = :usuario_id OR provider_id = :usuario_id) LIMIT 1`,
        { replacements: { booking_id, usuario_id }, type: QueryTypes.SELECT }
      );
      if (!belongs.length) return res.status(400).json({ error: 'CITA_NO_ASOCIADA', message: 'La cita no existe o no pertenece a tu cuenta.' });
    }
    if (evidencia_urls !== undefined && (!Array.isArray(evidencia_urls) || evidencia_urls.length > 3)) {
      return res.status(400).json({ error: 'EVIDENCIA_INVALIDA', message: 'Adjunta como máximo 3 imágenes.' });
    }
    const evidence = evidencia_urls || [];
    let evidenceBytes = 0;
    for (const item of evidence) {
      const match = typeof item === 'string' && item.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (!match) return res.status(400).json({ error: 'EVIDENCIA_INVALIDA', message: 'Las evidencias deben ser imágenes JPEG, PNG o WebP.' });
      const bytes = Math.floor(match[2].length * 3 / 4);
      evidenceBytes += bytes;
      if (bytes > 1500000 || evidenceBytes > 4500000) {
        return res.status(413).json({ error: 'EVIDENCIA_DEMASIADO_GRANDE', message: 'Máximo 1,5 MB por imagen y 4,5 MB en total.' });
      }
    }

    // Los valores admisibles se leen del CHECK real de la tabla. Antes no se validaba
    // nada aquí: un `tipo` que el esquema no admitía (o el 'ARCO_SUPRESION' que añadió la
    // migración 045) moría en un 500 genérico y parecía un fallo del servidor en vez de un
    // dato mal enviado.
    for (const [columna, valor] of [['tipo', tipo], ['categoria', categoria]]) {
      if (valor === undefined || valor === null) continue;
      const motivo = await motivoInvalido('tickets', columna, valor);
      if (motivo) return res.status(400).json({ error: 'VALOR_NO_ADMITIDO', message: motivo });
    }

    const query = `
      INSERT INTO tickets (usuario_id, booking_id, tipo, categoria, asunto, descripcion, evidencia_urls)
      VALUES (:usuario_id, :booking_id, :tipo, :categoria, :asunto, :descripcion, :evidencia_urls)
      RETURNING id, usuario_id, booking_id, tipo, categoria, asunto, descripcion, estado, prioridad, evidencia_urls, fecha_creacion;
    `;

    const results = await sequelize.query(query, {
      replacements: {
        usuario_id,
        booking_id: booking_id || null,
        tipo,
        categoria,
        asunto,
        descripcion,
        evidencia_urls: evidence,
      },
      type: QueryTypes.INSERT
    });

    const ticket = results[0][0];

    let notification = { status: 'admin_api_queue' };
    const configuredMailer = process.env.SUPPORT_INBOX_EMAIL
      && (process.env.BREVO_API_KEY || (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS));
    if (configuredMailer) {
      try {
        const mailer = require('../services/emailService');
        const sent = await mailer.sendEmail({
          to: process.env.SUPPORT_INBOX_EMAIL,
          subject: `Nueva solicitud ${ticket.id}: ${ticket.tipo}`,
          data: { text: `${ticket.asunto}\n\nTipo: ${ticket.tipo}\nCategoría: ${ticket.categoria}\nTicket: ${ticket.id}\n\nIngresa al panel de administración para gestionar el caso.` },
        });
        notification = sent?.devMode ? { status: 'admin_api_queue' } : { status: 'support_email_sent' };
      } catch (mailError) {
        console.error('[tickets] ticket guardado; aviso a soporte falló:', mailError.message);
        notification = { status: 'admin_api_queue', email_error: 'delivery_failed' };
      }
    }

    res.status(201).json({
      success: true,
      message: 'Solicitud radicada en el sistema de soporte. Consulta su estado en Centro de Soporte > Mis solicitudes.',
      management_channel: '/api/admin/tickets',
      notification,
      data: ticket,
    });
  } catch (error) {
    if (error && error.code === '23514') {
      return res.status(400).json({
        error: 'VALOR_NO_ADMITIDO',
        message: `El esquema rechazó el ticket: ${error.message}`,
      });
    }
    console.error('❌ ERROR EN POST /api/tickets:', error);
    res.status(500).json({ error: 'Error al crear el ticket.' });
  }
};

// GET /api/tickets/my-tickets -> Obtener los tickets del usuario autenticado
exports.getMyTickets = async (req, res) => {
  try {
    const usuario_id = req.user.id;
    const is_admin = req.user.role === 'admin';

    let query = `
      SELECT t.*, u.nombre as usuario_nombre, u.email as usuario_email 
      FROM tickets t
      JOIN usuarios u ON t.usuario_id = u.id
    `;
    const replacements = {};

    if (!is_admin) {
      query += ` WHERE t.usuario_id = :usuario_id`;
      replacements.usuario_id = usuario_id;
    }

    query += ` ORDER BY t.fecha_actualizacion DESC;`;

    const tickets = await sequelize.query(query, {
      replacements,
      type: QueryTypes.SELECT
    });

    res.json({
      success: true,
      data: tickets
    });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/tickets/my-tickets:', error);
    res.status(500).json({ error: 'Error al obtener tus tickets.' });
  }
};

// GET /api/tickets/:id/messages -> Obtener el hilo de conversación de un ticket
exports.getTicketMessages = async (req, res) => {
  try {
    const ticketId = req.params.id;
    const usuario_id = req.user.id;
    const is_admin = req.user.role === 'admin';

    // Verificar primero que el ticket pertenezca al usuario (o que sea admin)
    const checkTicketQuery = `SELECT usuario_id FROM tickets WHERE id = :ticketId;`;
    const ticketCheck = await sequelize.query(checkTicketQuery, {
      replacements: { ticketId },
      type: QueryTypes.SELECT
    });

    if (ticketCheck.length === 0) {
      return res.status(404).json({ error: 'Ticket no encontrado.' });
    }

    if (!is_admin && ticketCheck[0].usuario_id !== usuario_id) {
      return res.status(403).json({ error: 'No autorizado para ver este ticket.' });
    }

    const messagesQuery = `
      SELECT tm.*, u.nombre as remitente_nombre, u.rol as remitente_rol
      FROM ticket_mensajes tm
      JOIN usuarios u ON tm.remitente_id = u.id
      WHERE tm.ticket_id = :ticketId
      ORDER BY tm.fecha_envio ASC;
    `;

    const messages = await sequelize.query(messagesQuery, {
      replacements: { ticketId },
      type: QueryTypes.SELECT
    });

    res.json({
      success: true,
      data: messages
    });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/tickets/:id/messages:', error);
    res.status(500).json({ error: 'Error al obtener mensajes del ticket.' });
  }
};

// POST /api/tickets/:id/messages -> Responder/agregar mensaje a un ticket
exports.createTicketMessage = async (req, res) => {
  try {
    const ticketId = req.params.id;
    const sender_id = req.user.id;
    const { mensaje } = req.body;
    const is_admin = req.user.role === 'admin';

    // Esta guarda usaba una propiedad de JavaScript que NO EXISTE (viene de otros
    // lenguajes, no de JS): evaluaba `undefined` —falsy—, así que nunca rechazó nada y
    // se podían guardar respuestas en blanco en el hilo. Es justo la ruta por la que
    // responde el operador desde el panel.
    if (typeof mensaje !== 'string' || mensaje.trim().length === 0) {
      return res.status(400).json({ error: 'El mensaje no puede estar vacío.' });
    }
    const texto = mensaje.trim();
    // Autor del mensaje: es la costura que separa al usuario del operador humano (y, en
    // el futuro, del agente). Sin esto no se puede medir el tiempo de respuesta.
    const autor_tipo = is_admin ? 'OPERADOR' : 'USUARIO';

    // Verificar pertenencia/existencia
    const checkTicketQuery = `SELECT usuario_id FROM tickets WHERE id = :ticketId;`;
    const ticketCheck = await sequelize.query(checkTicketQuery, {
      replacements: { ticketId },
      type: QueryTypes.SELECT
    });

    if (ticketCheck.length === 0) {
      return res.status(404).json({ error: 'Ticket no encontrado.' });
    }

    if (!is_admin && ticketCheck[0].usuario_id !== sender_id) {
      return res.status(403).json({ error: 'No autorizado para responder en este ticket.' });
    }

    const insertQuery = `
      INSERT INTO ticket_mensajes (ticket_id, remitente_id, mensaje, autor_tipo)
      VALUES (:ticketId, :sender_id, :texto, :autor_tipo)
      RETURNING id, ticket_id, remitente_id, mensaje, autor_tipo, fecha_envio;
    `;

    const results = await sequelize.query(insertQuery, {
      replacements: { ticketId, sender_id, texto, autor_tipo },
      type: QueryTypes.INSERT
    });

    const newMsg = results[0][0];

    // Actualizar fecha_actualizacion del ticket y alternar estado si corresponde
    // Si responde el admin, cambiamos a ESPERANDO_RESPUESTA_USUARIO. Si responde el cliente, cambiamos a ABIERTO/EN_PROCESO.
    const nuevoEstado = is_admin ? 'ESPERANDO_RESPUESTA_USUARIO' : 'EN_PROCESO';
    // La PRIMERA respuesta de un operador es la que fija el tiempo de respuesta del
    // ticket. COALESCE lo hace idempotente: una segunda respuesta no la sobrescribe.
    const setPrimeraRespuesta = is_admin
      ? ', primera_respuesta_en = COALESCE(primera_respuesta_en, NOW())'
      : '';
    const updateTicketQuery = `
      UPDATE tickets 
      SET estado = :nuevoEstado, workflow_actor_id = :sender_id, fecha_actualizacion = NOW()${setPrimeraRespuesta}
      WHERE id = :ticketId;
    `;
    await sequelize.query(updateTicketQuery, {
      replacements: { nuevoEstado, ticketId, sender_id },
      type: QueryTypes.UPDATE
    });

    res.status(201).json({
      success: true,
      data: newMsg
    });
  } catch (error) {
    console.error('❌ ERROR EN POST /api/tickets/:id/messages:', error);
    res.status(500).json({ error: 'Error al enviar mensaje.' });
  }
};

// backend/src/controllers/chatController.js
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');
const { processAssistantMessage, AI_USER_ID } = require('../services/geminiService');
const { notifyUserChatMessage } = require('../services/websocketService');

// GET /api/chat/conversations → Listar conversaciones activas
exports.getConversations = async (req, res) => {
  try {
    const userId = req.user.id;

    const query = `
      SELECT DISTINCT ON (conversation_partner_id)
        m.conversation_partner_id,
        u.nombre as partner_name,
        u.foto_url as partner_avatar,
        CASE WHEN u.rol = 'PRESTADOR' THEN 'provider' ELSE 'client' END as partner_role,
        m.message as last_message,
        m.created_at as last_message_time,
        m.sender_id,
        (
          SELECT COUNT(*)::int 
          FROM messages 
          WHERE sender_id = m.conversation_partner_id 
            AND receiver_id = :userId 
            AND is_read = false
        ) as unread_count
      FROM (
        SELECT 
          CASE WHEN sender_id = :userId THEN receiver_id ELSE sender_id END as conversation_partner_id,
          message,
          created_at,
          sender_id
        FROM messages
        WHERE sender_id = :userId OR receiver_id = :userId
        ORDER BY created_at DESC
      ) m
      JOIN usuarios u ON u.id = m.conversation_partner_id
      ORDER BY m.conversation_partner_id, m.created_at DESC;
    `;

    const results = await sequelize.query(query, {
      replacements: { userId },
      type: QueryTypes.SELECT
    });
    
    const conversations = results.map(row => ({
      ...row,
      conversation_partner_id: row.conversation_partner_id.toString()
    }));

    conversations.sort((a, b) => new Date(b.last_message_time) - new Date(a.last_message_time));

    res.json({
      success: true,
      count: conversations.length,
      data: conversations
    });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/chat/conversations:', error);
    res.status(500).json({ error: 'Error al obtener conversaciones' });
  }
};

// GET /api/chat/messages/:partnerId → Historial de mensajes con un socio
exports.getMessages = async (req, res) => {
  try {
    const userId = req.user.id;
    const partnerId = req.params.partnerId;
    const resolvedPartnerId = (partnerId === '0' || partnerId === '00000000-0000-0000-0000-000000000000' || partnerId === AI_USER_ID.toString()) ? 0 : parseInt(partnerId);
    if (isNaN(resolvedPartnerId)) {
      return res.status(400).json({ error: 'El ID de socio no es un identificador válido' });
    }

    const query = `
      SELECT id, sender_id, receiver_id, message, is_read, created_at
      FROM messages
      WHERE (sender_id = :userId AND receiver_id = :resolvedPartnerId)
         OR (sender_id = :resolvedPartnerId AND receiver_id = :userId)
      ORDER BY created_at ASC;
    `;
    const results = await sequelize.query(query, {
      replacements: { userId, resolvedPartnerId },
      type: QueryTypes.SELECT
    });
    
    const formattedMessages = results.map(row => ({
      ...row,
      sender_id: row.sender_id.toString(),
      receiver_id: row.receiver_id.toString()
    }));

    res.json({
      success: true,
      count: formattedMessages.length,
      data: formattedMessages
    });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/chat/messages/:partnerId:', error);
    res.status(500).json({ error: 'Error al obtener mensajes' });
  }
};

// POST /api/chat/messages → Enviar un mensaje
exports.sendMessage = async (req, res) => {
  try {
    const senderId = req.user.id;
    const { receiver_id, message, image_path } = req.body;

    if (!receiver_id || !message || message.trim() === '') {
      return res.status(400).json({ error: 'receiver_id y message son obligatorios' });
    }

    const targetReceiver = (receiver_id === '0' || receiver_id === '00000000-0000-0000-0000-000000000000' || receiver_id === AI_USER_ID.toString()) ? 0 : parseInt(receiver_id);
    if (isNaN(targetReceiver)) {
      return res.status(400).json({ error: 'El ID de receptor no es un identificador válido' });
    }

    // Sistema de Detección y Prevención de Evasión (Anti-Circumvention Filter)
    const onlyDigits = message.replace(/\D/g, '');
    const containsPhone = /3[0-9]{9}|60[0-9]{8}/.test(onlyDigits);
    const containsEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(message);
    const containsSocial = /@[a-zA-Z0-9_._]+/.test(message);
    
    const forbiddenPatterns = [
      'por fuera', 'pago directo', 'pago en efectivo', 'efectivo directo', 
      'whatsapp', 'wpp', 'escríbame', 'escribame', 'nequi directo', 
      'transferencia directa', 'llámeme', 'llamame', 'escríbeme', 'escribeme',
      'mi cel', 'mi número', 'mi numero', 'número de contacto', 'numero de contacto'
    ];
    
    const lowerMessage = message.toLowerCase();
    const containsForbiddenPattern = forbiddenPatterns.some(pat => lowerMessage.includes(pat));

    if (targetReceiver !== 0) {
      if (containsPhone || containsEmail || containsSocial || containsForbiddenPattern) {
        return res.status(400).json({ 
          error: 'Por motivos de seguridad y políticas de la plataforma, no está permitido compartir información de contacto directo (teléfonos, correos, redes sociales) ni negociar pagos externos fuera de la aplicación. Por favor, mantenga su comunicación y transacciones dentro de Belleza App.' 
        });
      }
    }

    const query = `
      INSERT INTO messages (sender_id, receiver_id, message)
      VALUES (:senderId, :targetReceiver, :message)
      RETURNING id, sender_id, receiver_id, message, is_read, created_at;
    `;
    const results = await sequelize.query(query, {
      replacements: { senderId, targetReceiver, message: message.trim() },
      type: QueryTypes.INSERT
    });
    
    // results en INSERT en pg retorna [rows, metadata]
    const row = results?.[0]?.[0];
    if (!row) {
      return res.status(500).json({ error: 'No se pudo registrar el mensaje' });
    }
    const formatted = {
      ...row,
      sender_id: row.sender_id.toString(),
      receiver_id: row.receiver_id.toString()
    };

    res.status(201).json({
      success: true,
      data: formatted
    });

    // Notificar al receptor en tiempo real vía WebSocket
    notifyUserChatMessage(targetReceiver, formatted);

    if (targetReceiver === 0) {
      const senderRole = req.user?.rol || 'client';
      const senderTenantId = req.user?.tenant_id || null;
      processAssistantMessage(senderId, message.trim(), image_path, senderRole, senderTenantId).catch(err => {
        console.error('❌ Error en procesamiento asíncrono del Asistente de IA:', err);
      });
    }

  } catch (error) {
    console.error('❌ ERROR EN POST /api/chat/messages:', error);
    res.status(500).json({ error: 'Error al enviar el mensaje' });
  }
};

// PATCH /api/chat/messages/:partnerId/read → Marcar mensajes recibidos como leídos
exports.readMessages = async (req, res) => {
  try {
    const userId = req.user.id;
    const partnerId = req.params.partnerId;
    const resolvedPartnerId = (partnerId === '0' || partnerId === '00000000-0000-0000-0000-000000000000' || partnerId === AI_USER_ID.toString()) ? 0 : parseInt(partnerId);
    if (isNaN(resolvedPartnerId)) {
      return res.status(400).json({ error: 'El ID de socio no es un identificador válido' });
    }

    const query = `
      UPDATE messages
      SET is_read = true
      WHERE sender_id = :resolvedPartnerId AND receiver_id = :userId AND is_read = false
      RETURNING id;
    `;
    const results = await sequelize.query(query, {
      replacements: { resolvedPartnerId, userId },
      type: QueryTypes.UPDATE
    });
    
    // En UPDATE, pg retorna [rows, metadata] o similar
    const rows = results?.[0] || [];
    res.json({
      success: true,
      count: rows.length
    });
  } catch (error) {
    console.error('❌ ERROR EN PATCH /api/chat/messages/:partnerId/read:', error);
    res.status(500).json({ error: 'Error al marcar mensajes como leídos' });
  }
};

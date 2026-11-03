// backend/src/services/websocketService.js
const { WebSocketServer } = require('ws');
const { pool } = require('../config/db');
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../config/jwt');

let wss = null;
const wsClients = new Map(); // userId -> Set of WS connections

const registerClient = (userId, ws) => {
  const userIdStr = userId.toString();
  if (!wsClients.has(userIdStr)) {
    wsClients.set(userIdStr, new Set());
  }
  wsClients.get(userIdStr).add(ws);
  console.log(`👤 Conexión WS registrada para usuario: ${userIdStr}`);
};

const unregisterClient = (ws) => {
  for (const [userId, connSet] of wsClients.entries()) {
    if (connSet.has(ws)) {
      connSet.delete(ws);
      if (connSet.size === 0) wsClients.delete(userId);
      console.log(`🔌 Conexión WS removida para usuario: ${userId}`);
      break;
    }
  }
};

const notifyUserChatMessage = (userId, messageData) => {
  const userIdStr = userId.toString();
  if (wsClients.has(userIdStr)) {
    const payload = JSON.stringify({
      type: 'chat_message',
      data: messageData
    });
    for (const conn of wsClients.get(userIdStr)) {
      if (conn.readyState === 1) { // OPEN
        conn.send(payload);
      }
    }
  }
};

const notifyUserAuraStatus = (userId, statusData) => {
  const userIdStr = userId.toString();
  if (wsClients.has(userIdStr)) {
    const payload = JSON.stringify({
      type: 'aura_status',
      data: statusData
    });
    for (const conn of wsClients.get(userIdStr)) {
      if (conn.readyState === 1) { // OPEN
        conn.send(payload);
      }
    }
  }
};

const initWebSocketServer = (server) => {
  wss = new WebSocketServer({ server });
  
  wss.on('connection', (ws) => {
    console.log('🔌 Nuevo cliente WebSocket conectado.');
    
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message);
        if (data.type === 'register') {
          // El token es OBLIGATORIO. La rama `else if (data.userId)` permitía registrar
          // —y por tanto suplantar— a cualquier usuario enviando solo su id, sin credencial
          // alguna (A360-2026-09-22/C-04).
          try {
            if (!data.token || typeof data.token !== 'string') {
              throw new Error('Falta el token JWT');
            }
            const decoded = jwt.verify(data.token, getJwtSecret());
            const verifiedUserId = decoded.id;
            if (!verifiedUserId) throw new Error('Token sin id de usuario');
            ws.authenticatedUserId = verifiedUserId;
            registerClient(verifiedUserId, ws);
            ws.send(JSON.stringify({ status: 'registered', userId: verifiedUserId.toString() }));
          } catch (jwtErr) {
            console.error('WebSocket auth fallida:', jwtErr.message);
            ws.send(JSON.stringify({ error: 'Token inválido o expirado' }));
          }
        }
        // Integración de Geolocalización en Tiempo Real vía WebSockets para Tracking
        if (data.type === 'join_booking_room' && data.bookingId) {
          if (!ws.authenticatedUserId) {
            return ws.send(JSON.stringify({ error: 'Debes registrarte con un token antes de unirte a una sala' }));
          }
          try {
            // Solo el cliente o el prestador de ESA cita pueden unirse a su sala.
            // Antes cualquier conexión podía unirse a cualquier reserva y recibir
            // la geolocalización en tiempo real de terceros (A360-2026-09-22/C-04).
            const authz = await pool.query(
              'SELECT 1 FROM bookings WHERE id = $1 AND (client_id = $2 OR provider_id = $2) LIMIT 1',
              [data.bookingId, ws.authenticatedUserId]
            );
            if (authz.rows.length === 0) {
              console.warn(`⛔ Sala rechazada: usuario ${ws.authenticatedUserId} no pertenece al booking ${data.bookingId}`);
              return ws.send(JSON.stringify({ error: 'No tienes acceso a esta reserva' }));
            }
          } catch (authzErr) {
            console.error('Error verificando acceso a la sala:', authzErr.message);
            return ws.send(JSON.stringify({ error: 'No se pudo verificar el acceso a la reserva' }));
          }
          ws.bookingId = data.bookingId;
          ws.role = data.role || 'client';
          console.log(`📡 Cliente WS unido a la sala del booking_${data.bookingId} como ${ws.role}`);
          ws.send(JSON.stringify({ type: 'joined_room', bookingId: data.bookingId }));
        }
        if (data.type === 'location_update' && data.bookingId && data.latitude && data.longitude) {
          if (!ws.authenticatedUserId) {
            return ws.send(JSON.stringify({ error: 'Debes registrarte con un token antes de enviar ubicación' }));
          }
          console.log(`📍 Recibida coordenada GPS de prestador para booking_${data.bookingId}: ${data.latitude}, ${data.longitude}`);
          
          // Actualizar base de datos de manera hiper-local.
          // El id del prestador sale del TOKEN, nunca del payload: antes cualquiera podía
          // mover la ubicación de cualquier prestador mandando su providerId (A360-2026-09-22/C-04).
          // `perfiles_prestador.id` es el id del usuario (init.sql), así que authenticatedUserId es el id correcto.
          pool.query(
            `UPDATE perfiles_prestador 
             SET ubicacion = ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography 
             WHERE id = $3`,
            [data.latitude, data.longitude, ws.authenticatedUserId]
          ).catch(e => console.error('Error actualizando ubicación prestador:', e.message));

          // Retransmitir a todos los clientes que estén en el mismo bookingId
          const payload = JSON.stringify({
            type: 'location_received',
            bookingId: data.bookingId,
            latitude: data.latitude,
            longitude: data.longitude,
            timestamp: new Date().toISOString()
          });

          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === 1 && client.bookingId === data.bookingId) {
              client.send(payload);
            }
          });
        }
      } catch (err) {
        console.error('Error procesando mensaje WebSocket:', err);
      }
    });
    
    ws.on('close', () => {
      unregisterClient(ws);
    });
  });
  
  return wss;
};

const notifyProviderNewBooking = (providerId, message) => {
  const providerIdStr = providerId.toString();
  if (wsClients.has(providerIdStr)) {
    const payload = JSON.stringify({
      type: 'new_booking',
      data: {
        message: message,
        sound_text: 'glowapp'
      }
    });
    for (const conn of wsClients.get(providerIdStr)) {
      if (conn.readyState === 1) { // OPEN
        conn.send(payload);
      }
    }
  }
};

module.exports = {
  registerClient,
  unregisterClient,
  notifyUserChatMessage,
  notifyUserAuraStatus,
  initWebSocketServer,
  notifyProviderNewBooking
};

// backend/src/sockets/serviceLocationHandler.js
// GPS en tiempo real del PRESTADOR acercándose a la CITA ("Concierge en Camino")
// NO es tracking de envío/paquete (eso está en tabla `envios` + endpoints admin)
const { pool } = require('../config/db');

module.exports = (io, socket) => {
  console.log(`🔌 Cliente conectado al socket de ubicación de servicio: ${socket.id}`);

  // El cliente o prestador se une a una sala de reserva específica
  socket.on('join_booking_room', ({ bookingId, role }) => {
    socket.join(`booking_${bookingId}`);
    console.log(`📡 Socket ${socket.id} se unió a la sala booking_${bookingId} como ${role}`);
  });

  // El prestador envía una actualización de coordenadas GPS reales
  socket.on('location_update', async ({ bookingId, latitude, longitude, providerId }) => {
    try {
      console.log(`📍 Actualización de ubicación para cita ${bookingId}: Lat ${latitude}, Lon ${longitude}`);

      // Opcional: Guardar en la base de datos la ubicación más reciente del prestador
      if (providerId) {
        await pool.query(
          `UPDATE perfiles_prestador 
           SET ubicacion = ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography 
           WHERE id = $3`,
          [latitude, longitude, providerId]
        );
      }

      // Retransmitir las coordenadas en tiempo real a todos los clientes (ej. el cliente final) en la sala
      socket.to(`booking_${bookingId}`).emit('location_received', {
        latitude,
        longitude,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error('❌ Error procesando location_update:', err.message);
    }
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Cliente desconectado del socket de ubicación de servicio: ${socket.id}`);
  });
};
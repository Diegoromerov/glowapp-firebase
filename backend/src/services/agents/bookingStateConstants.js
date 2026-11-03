// backend/src/services/agents/bookingStateConstants.js

/**
 * Constantes centralizadas para los estados de reservas (bookings.estado) en PostgreSQL.
 * Valores reales observados en bookings.estado:
 * - 'PENDIENTE_PAGO': Cita creada pendiente de confirmación de pago por pasarela (Wompi)
 * - 'CONFIRMADA': Cita confirmada y pagada, ocupando espacio en la agenda del prestador
 * - 'EN_PROGRESO': Cita en atención activa por parte del prestador
 * - 'COMPLETADA': Cita finalizada exitosamente
 * - 'CANCELADA': Cita cancelada
 */
const ESTADOS_QUE_OCUPAN_AGENDA = ['PENDIENTE_PAGO', 'CONFIRMADA', 'EN_PROGRESO'];
const ESTADO_COMPLETADO = 'COMPLETADA';

module.exports = {
  ESTADOS_QUE_OCUPAN_AGENDA,
  ESTADO_COMPLETADO
};

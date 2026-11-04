// ¿Puede este prestador atender HOY? Ordenar por cercanía y dejar fuera a quien
// no tiene hueco es lo que el usuario espera de "cerca y disponible hoy": una
// ficha a 300 m que solo tiene cita el jueves no es una opción.
//
// La regla imita a /api/providers/:id/slots: rejilla de 30 minutos desde la hora
// de apertura, sin solapar con lo ya reservado ni con el pasado.

const PASO_MINUTOS = 30;

/**
 * @param {Object} opciones
 * @param {Date} opciones.ahora            Momento actual (inyectable para probar).
 * @param {number|null} opciones.horaInicio Hora de apertura (0-23). null = sin horario.
 * @param {number|null} opciones.horaFin    Hora de cierre (0-23).
 * @param {number} opciones.duracionMinutos Duración mínima de sus servicios.
 * @param {Array<{inicio: Date, fin: Date}>} opciones.ocupados Reservas de hoy.
 * @returns {string|null} 'HH:MM' del primer hueco, o null si no hay.
 */
function calcularHuecoHoy({
  ahora,
  horaInicio,
  horaFin,
  duracionMinutos,
  ocupados = [],
  pasoMinutos = PASO_MINUTOS,
}) {
  if (horaInicio === null || horaInicio === undefined) return null;
  if (horaFin === null || horaFin === undefined) return null;
  const duracion = Number(duracionMinutos);
  if (!Number.isFinite(duracion) || duracion <= 0) return null;

  const inicioDia = new Date(ahora);
  inicioDia.setHours(horaInicio, 0, 0, 0);
  const finDia = new Date(ahora);
  finDia.setHours(horaFin, 0, 0, 0);

  // Si ya cerró, no hay hueco hoy.
  if (ahora >= finDia) return null;

  // Primer paso de la rejilla que no esté en el pasado.
  let cursor = new Date(Math.max(inicioDia.getTime(), ahora.getTime()));
  const resto = cursor.getMinutes() % pasoMinutos;
  if (resto !== 0) {
    cursor = new Date(cursor.getTime() + (pasoMinutos - resto) * 60 * 1000);
    cursor.setSeconds(0, 0);
  }

  const fin = (d) => new Date(d.getTime() + duracion * 60 * 1000);

  while (fin(cursor) <= finDia) {
    const choque = ocupados.some((o) => cursor < o.fin && fin(cursor) > o.inicio);
    if (!choque) {
      return `${String(cursor.getHours()).padStart(2, '0')}:${String(cursor.getMinutes()).padStart(2, '0')}`;
    }
    cursor = new Date(cursor.getTime() + pasoMinutos * 60 * 1000);
  }

  return null;
}

module.exports = { calcularHuecoHoy, PASO_MINUTOS };

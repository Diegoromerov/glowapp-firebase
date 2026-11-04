// ¿Puede este prestador atender HOY? Ordenar por cercanía y dejar fuera a quien
// no tiene hueco es lo que el usuario espera de "cerca y disponible hoy": una
// ficha a 300 m que solo tiene cita el jueves no es una opción.
//
// La regla imita a /api/providers/:id/slots: rejilla de 30 minutos desde la hora
// de apertura, sin solapar con lo ya reservado ni con el pasado.
//
// ZONA HORARIA: el horario del prestador es local (Bogotá) y el contenedor corre
// en UTC. Con setHours sobre la hora del servidor, a las 05:30 UTC (00:30 en
// Bogotá) devolvía "09:00", que en Colombia son las 4 de la mañana. Colombia no
// tiene horario de verano, así que un desplazamiento fijo de -5 horas es exacto.

const PASO_MINUTOS = 30;
const OFFSET_COLOMBIA_HORAS = -5;

/**
 * @param {Object} opciones
 * @param {Date} opciones.ahora             Momento actual (inyectable para probar).
 * @param {number|null} opciones.horaInicio Hora de apertura local (0-23). null = sin horario.
 * @param {number|null} opciones.horaFin    Hora de cierre local (0-23).
 * @param {number} opciones.duracionMinutos Duración mínima de sus servicios.
 * @param {Array<{inicio: Date, fin: Date}>} opciones.ocupados Reservas de hoy.
 * @param {number} [opciones.offsetHoras]   Desplazamiento respecto a UTC.
 * @returns {string|null} 'HH:MM' local del primer hueco, o null si no hay.
 */
function calcularHuecoHoy({
  ahora,
  horaInicio,
  horaFin,
  duracionMinutos,
  ocupados = [],
  pasoMinutos = PASO_MINUTOS,
  offsetHoras = OFFSET_COLOMBIA_HORAS,
}) {
  if (horaInicio === null || horaInicio === undefined) return null;
  if (horaFin === null || horaFin === undefined) return null;
  const duracion = Number(duracionMinutos);
  if (!Number.isFinite(duracion) || duracion <= 0) return null;

  // Todo el cálculo va en milisegundos "desplazados": sumar el offset convierte
  // el instante real en hora local y las comparaciones quedan en aritmética pura.
  const desplazamiento = offsetHoras * 60 * 60 * 1000;
  const ahoraLocal = ahora.getTime() + desplazamiento;

  const dia = new Date(ahoraLocal);
  dia.setUTCHours(0, 0, 0, 0);
  const medianoche = dia.getTime();
  const inicioDia = medianoche + horaInicio * 60 * 60 * 1000;
  const finDia = medianoche + horaFin * 60 * 60 * 1000;

  if (ahoraLocal >= finDia) return null;

  const paso = pasoMinutos * 60 * 1000;
  const duracionMs = duracion * 60 * 1000;

  let cursor = Math.max(inicioDia, ahoraLocal);
  const resto = (cursor - medianoche) % paso;
  if (resto !== 0) cursor += paso - resto;

  const ocupadosLocal = ocupados.map((o) => ({
    inicio: o.inicio.getTime() + desplazamiento,
    fin: o.fin.getTime() + desplazamiento,
  }));

  while (cursor + duracionMs <= finDia) {
    const choque = ocupadosLocal.some(
      (o) => cursor < o.fin && cursor + duracionMs > o.inicio
    );
    if (!choque) {
      const minutos = Math.floor((cursor - medianoche) / 60000);
      const h = Math.floor(minutos / 60);
      const m = minutos % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    cursor += paso;
  }

  return null;
}

module.exports = { calcularHuecoHoy, PASO_MINUTOS, OFFSET_COLOMBIA_HORAS };

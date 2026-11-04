// El home ordena por «cerca y disponible hoy»: si el hueco se calcula mal, se
// ofrece una cita que no existe y el usuario llega a un calendario vacío.
//
// Los instantes se construyen en UTC a propósito: el cálculo convierte a hora de
// Bogotá con un desplazamiento fijo, y así la prueba no depende de la zona del
// equipo que la ejecute.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { calcularHuecoHoy } = require(path.join(__dirname, '..', 'utils', 'disponibilidad'));

// 10:07 en Bogotá = 15:07 UTC del mismo día.
const ahora = new Date(Date.UTC(2026, 10, 4, 15, 7, 0));
const enLocal = (hora, minuto) => new Date(Date.UTC(2026, 10, 4, hora + 5, minuto, 0));

test('con la agenda libre devuelve el siguiente paso de 30 min, en hora de Bogotá', () => {
  const hueco = calcularHuecoHoy({
    ahora,
    horaInicio: 9,
    horaFin: 18,
    duracionMinutos: 60,
    ocupados: [],
  });
  assert.equal(hueco, '10:30');
});

test('salta la cita que ya ocupa la franja', () => {
  const hueco = calcularHuecoHoy({
    ahora,
    horaInicio: 9,
    horaFin: 18,
    duracionMinutos: 60,
    ocupados: [{ inicio: enLocal(10, 30), fin: enLocal(11, 30) }],
  });
  assert.equal(hueco, '11:30');
});

test('sin hueco antes del cierre devuelve null', () => {
  const hueco = calcularHuecoHoy({
    ahora,
    horaInicio: 9,
    horaFin: 12,
    duracionMinutos: 60,
    ocupados: [
      { inicio: enLocal(10, 30), fin: enLocal(11, 30) },
      { inicio: enLocal(11, 30), fin: enLocal(12, 0) },
    ],
  });
  assert.equal(hueco, null);
});

test('de madrugada en Colombia no ofrece la mañana como si ya hubiera pasado', () => {
  // 00:30 en Bogotá = 05:30 UTC. El prestador abre a las 9: el hueco es 09:00.
  const madrugada = new Date(Date.UTC(2026, 10, 4, 5, 30, 0));
  const hueco = calcularHuecoHoy({
    ahora: madrugada,
    horaInicio: 9,
    horaFin: 18,
    duracionMinutos: 60,
    ocupados: [],
  });
  assert.equal(hueco, '09:00');
});

test('fuera de horario no inventa disponibilidad', () => {
  // 19:00 en Bogotá = 00:00 UTC del día siguiente.
  const noche = new Date(Date.UTC(2026, 10, 5, 0, 0, 0));
  const hueco = calcularHuecoHoy({
    ahora: noche,
    horaInicio: 9,
    horaFin: 18,
    duracionMinutos: 60,
    ocupados: [],
  });
  assert.equal(hueco, null);
});

test('a media manana en Colombia no devuelve la hora del servidor', () => {
  // 10:00 en Bogota = 15:00 UTC. Con el calculo en UTC devolvia '15:00'.
  const manana = new Date(Date.UTC(2026, 10, 4, 15, 0, 0));
  const hueco = calcularHuecoHoy({
    ahora: manana,
    horaInicio: 9,
    horaFin: 18,
    duracionMinutos: 60,
    ocupados: [],
  });
  assert.equal(hueco, '10:00');
});

test('un prestador sin horario configurado no se marca como disponible', () => {
  const hueco = calcularHuecoHoy({
    ahora,
    horaInicio: null,
    horaFin: null,
    duracionMinutos: 60,
    ocupados: [],
  });
  assert.equal(hueco, null);
});

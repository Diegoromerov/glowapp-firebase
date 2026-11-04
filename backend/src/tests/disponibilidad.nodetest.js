// El home ordena por «cerca y disponible hoy»: si el hueco se calcula mal, se
// ofrece una cita que no existe y el usuario llega a un calendario vacío.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { calcularHuecoHoy } = require(
  path.join(__dirname, '..', 'utils', 'disponibilidad')
);

// 2026-11-04 10:07 hora local
const ahora = new Date(2026, 10, 4, 10, 7, 0);

function enPunto(hora, minuto) {
  return new Date(2026, 10, 4, hora, minuto, 0);
}

test('con la agenda libre devuelve el siguiente paso de 30 min', () => {
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
    ocupados: [{ inicio: enPunto(10, 30), fin: enPunto(11, 30) }],
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
      { inicio: enPunto(10, 30), fin: enPunto(11, 30) },
      { inicio: enPunto(11, 30), fin: enPunto(12, 0) },
    ],
  });
  assert.equal(hueco, null);
});

test('fuera de horario no inventa disponibilidad', () => {
  const tarde = new Date(2026, 10, 4, 19, 0, 0);
  const hueco = calcularHuecoHoy({
    ahora: tarde,
    horaInicio: 9,
    horaFin: 18,
    duracionMinutos: 60,
    ocupados: [],
  });
  assert.equal(hueco, null);
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

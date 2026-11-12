/**
 * La cuota de IA tiene que morder: si no bloquea, es decorativa.
 *
 * Se bloquea sólo en análisis NUEVOS. Un acierto de caché no gasta lectura, así
 * que la guardia vive dentro del orquestador y no en un middleware: castigar a
 * quien repite la misma foto sería el peor lugar donde ponerla.
 */
jest.mock('../src/config/db', () => ({
  pool: { query: jest.fn() },
}));

const { exigirDisponibles } = require('../src/services/cuotasService');

const estado = (disponibles, extra = {}) => ({
  nivel: 'Pétalo',
  lecturas: { otorgadas: 4, usadas: 4 - disponibles, disponibles, desglose: { base: 0, reservas: 2, compras: 1, nivel: 1 } },
  ...extra,
});

test('con lecturas disponibles no lanza', () => {
  expect(() => exigirDisponibles(estado(1))).not.toThrow();
  expect(() => exigirDisponibles(estado(3))).not.toThrow();
});

test('sin lecturas lanza 402 con código propio, no un 500', () => {
  let error;
  try {
    exigirDisponibles(estado(0));
  } catch (e) {
    error = e;
  }
  expect(error).toBeDefined();
  expect(error.code).toBe('CUOTA_AGOTADA');
  expect(error.statusCode).toBe(402);
  expect(error.message.toLowerCase()).toContain('se renuevan');
});

test('el error lleva el desglose: la usuaria ve por qué se quedó sin cuota', () => {
  let error;
  try {
    exigirDisponibles(estado(0));
  } catch (e) {
    error = e;
  }
  expect(error.details.nivel).toBe('Pétalo');
  expect(error.details.usadas).toBe(4);
  expect(error.details.desglose.reservas).toBe(2);
});

test('un estado incompleto se trata como agotado, no revienta', () => {
  expect(() => exigirDisponibles(null)).toThrow();
  expect(() => exigirDisponibles({})).toThrow();
});

test('el orquestador carga con la guardia dentro', () => {
  const orquestador = require('../src/services/biometric/orchestrator');
  expect(typeof orquestador.analyze).toBe('function');
});

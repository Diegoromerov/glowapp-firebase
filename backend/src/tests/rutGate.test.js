'use strict';

/**
 * Gate de publicación por RUT (D-GL-030, fase 2).
 *
 * El middleware arranca en `warn` para no dejar sin catálogo a los prestadores
 * que ya operan el día del despliegue, y sólo bloquea con `RUT_GATE_MODE=block`.
 * Si esa distinción se rompe, o se bloquea a todos de golpe o no se bloquea nunca.
 */

jest.mock('../config/db', () => ({
  pool: { query: jest.fn() },
}));

const { pool } = require('../config/db');
const { exigirRutAprobado, modoActual } = require('../middleware/rutAprobado');

const ORIGINAL = process.env.RUT_GATE_MODE;

function respuestaFalsa() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => {
  pool.query.mockReset();
});

afterAll(() => {
  if (ORIGINAL === undefined) delete process.env.RUT_GATE_MODE;
  else process.env.RUT_GATE_MODE = ORIGINAL;
});

test('un RUT aprobado pasa sin ruido', async () => {
  pool.query.mockResolvedValue({ rows: [{ revision_estado: 'APROBADA', rut_numero: '1020304050' }] });
  const next = jest.fn();
  const res = respuestaFalsa();

  await exigirRutAprobado({ user: { id: 7 }, method: 'POST', originalUrl: '/api/services' }, res, next);

  expect(next).toHaveBeenCalledTimes(1);
  expect(res.status).not.toHaveBeenCalled();
});

test('en modo warn deja pasar aunque el RUT no esté aprobado', async () => {
  process.env.RUT_GATE_MODE = 'warn';
  pool.query.mockResolvedValue({ rows: [{ revision_estado: 'PENDIENTE', rut_numero: '1020304050' }] });
  const next = jest.fn();
  const res = respuestaFalsa();

  await exigirRutAprobado({ user: { id: 7 }, method: 'POST', originalUrl: '/api/services' }, res, next);

  expect(next).toHaveBeenCalledTimes(1);
});

test('en modo block rechaza con 409 y el estado de la revisión', async () => {
  process.env.RUT_GATE_MODE = 'block';
  pool.query.mockResolvedValue({ rows: [{ revision_estado: 'RECHAZADA', rut_numero: '1020304050' }] });
  const next = jest.fn();
  const res = respuestaFalsa();

  await exigirRutAprobado({ user: { id: 7 }, method: 'POST', originalUrl: '/api/services' }, res, next);

  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(409);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ error: 'RUT_NO_APROBADO', estado_revision: 'RECHAZADA' })
  );
});

test('sin fila de usuario responde 404', async () => {
  pool.query.mockResolvedValue({ rows: [] });
  const next = jest.fn();
  const res = respuestaFalsa();

  await exigirRutAprobado({ user: { id: 99 } }, res, next);

  expect(res.status).toHaveBeenCalledWith(404);
});

test('un modo desconocido cae en warn en lugar de bloquear', () => {
  process.env.RUT_GATE_MODE = 'bloqueo_total';
  expect(modoActual()).toBe('warn');
});

test('sin variable de entorno el modo por defecto es warn', () => {
  delete process.env.RUT_GATE_MODE;
  expect(modoActual()).toBe('warn');
});

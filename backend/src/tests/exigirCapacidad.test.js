'use strict';

/**
 * Puerta por capacidad (D-GL-031).
 *
 * Se comprueba que el bloqueo devuelve el motivo y el siguiente paso (no un
 * "prohibido" seco) y que un error de base no se convierte en un permiso: la
 * puerta falla cerrada.
 */

jest.mock('../config/db', () => ({
  pool: { query: jest.fn() },
}));

const { pool } = require('../config/db');
const { exigirCapacidad } = require('../middleware/exigirCapacidad');

function respuestaFalsa() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

const pedir = (capacidad) => ({
  user: { id: 7 },
  method: 'POST',
  originalUrl: '/api/test',
  ...{ capacidad },
});

beforeEach(() => pool.query.mockReset());

test('un prestador habilitado pasa', async () => {
  pool.query.mockResolvedValue({ rows: [{ estado_operativo: 'HABILITADO', rol: 'PRESTADOR' }] });
  const next = jest.fn();
  const res = respuestaFalsa();

  await exigirCapacidad('COBRAR')(pedir(), res, next);

  expect(next).toHaveBeenCalledTimes(1);
  expect(res.status).not.toHaveBeenCalled();
});

test('un explorador que intenta cobrar recibe 409 con instrucciones', async () => {
  pool.query.mockResolvedValue({ rows: [{ estado_operativo: 'EXPLORACION', rol: 'PRESTADOR' }] });
  const next = jest.fn();
  const res = respuestaFalsa();

  await exigirCapacidad('COBRAR')(pedir(), res, next);

  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(409);
  const cuerpo = res.json.mock.calls[0][0];
  expect(cuerpo.error).toBe('CAPACIDAD_DENEGADA');
  expect(cuerpo.capacidad).toBe('COBRAR');
  expect(cuerpo.siguiente_paso).toBe('VERIFICAR_DOCUMENTOS');
  expect(cuerpo.mensaje).toMatch(/Modo Exploración/);
});

test('un explorador sí puede crear servicios', async () => {
  pool.query.mockResolvedValue({ rows: [{ estado_operativo: 'EXPLORACION', rol: 'PRESTADOR' }] });
  const next = jest.fn();
  const res = respuestaFalsa();

  await exigirCapacidad('CREAR_SERVICIOS')(pedir(), res, next);

  expect(next).toHaveBeenCalledTimes(1);
});

test('sin autenticación responde 401', async () => {
  const next = jest.fn();
  const res = respuestaFalsa();

  await exigirCapacidad('COBRAR')({ user: null }, res, next);

  expect(res.status).toHaveBeenCalledWith(401);
});

test('una capacidad vacía es un error de programación, no un permiso', () => {
  expect(() => exigirCapacidad('')).toThrow();
});

test('si la consulta falla, la petición no se autoriza', async () => {
  pool.query.mockRejectedValue(new Error('db caída'));
  const next = jest.fn();
  const res = respuestaFalsa();

  await exigirCapacidad('COBRAR')(pedir(), res, next);

  // Falla cerrado: el error va al manejador de Express, no se deja pasar la
  // petición como si tuviera permiso.
  expect(res.status).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalledTimes(1);
  expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
});

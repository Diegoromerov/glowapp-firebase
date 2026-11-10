// Ítem 70 — un 5xx debe quedar registrado, no solo impreso en consola.
//
// Se prueba el middleware de errores con un pool simulado: que un 500 escriba
// un evento API_5XX con la ruta en metadata, y que un 4xx no ensucie la tabla
// (un 400 no es un fallo del servidor y contarlo distorsiona la métrica).
jest.mock('../config/db', () => ({
  pool: { query: jest.fn(() => Promise.resolve({ rows: [], rowCount: 1 })) },
}));

const { pool } = require('../config/db');
const errorHandler = require('../middleware/errorHandler');

function resFalso() {
  const res = {
    statusCode: null,
    body: null,
    headersSent: false,
    status(codigo) {
      this.statusCode = codigo;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe('errorHandler — visibilidad de 5xx', () => {
  beforeEach(() => pool.query.mockClear());

  test('un 500 se guarda como API_5XX con ruta y request_id', () => {
    const res = resFalso();
    errorHandler(
      Object.assign(new Error('boom interno'), { statusCode: 500 }),
      { method: 'GET', originalUrl: '/api/x', id: 'req-123' },
      res,
      () => {},
    );

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('Error interno del servidor');
    expect(pool.query).toHaveBeenCalledTimes(1);

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('API_5XX');
    const meta = JSON.parse(params[0]);
    expect(meta.ruta).toBe('/api/x');
    expect(meta.status).toBe(500);
    expect(meta.request_id).toBe('req-123');
  });

  test('un 4xx no se registra', () => {
    const res = resFalso();
    errorHandler(
      Object.assign(new Error('no autorizado'), { statusCode: 401 }),
      { method: 'GET', originalUrl: '/api/y', id: 'req-9' },
      res,
      () => {},
    );
    expect(res.statusCode).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('si la base falla al registrar, la respuesta sale igual', () => {
    pool.query.mockImplementationOnce(() => Promise.reject(new Error('db caída')));
    const res = resFalso();
    expect(() =>
      errorHandler(new Error('x'), { method: 'POST', originalUrl: '/api/z' }, res, () => {}),
    ).not.toThrow();
    expect(res.statusCode).toBe(500);
  });
});

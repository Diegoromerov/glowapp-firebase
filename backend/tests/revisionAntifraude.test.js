// Revisión antifraude de conversiones (F3).
//
// Marcar y no acreditar evita que una granja de cuentas cobre sola. Pero una
// marca sin salida es una conversión perdida: aprobar tiene que acreditar de
// verdad y no dos veces, y rechazar tiene que cerrar el caso.
jest.mock('../src/config/db', () => ({
  pool: { query: jest.fn(), connect: jest.fn() },
}));
jest.mock('../src/services/pointsService', () => ({
  acreditar: jest.fn(),
  PointsError: class PointsError extends Error {},
}));
jest.mock('../src/middleware/auth', () => {
  const actual = jest.requireActual('../src/middleware/auth');
  return {
    ...actual,
    authMiddleware: (req, res, next) => {
      const rol = req.headers['x-user-role'];
      if (!rol) return res.status(401).json({ error: 'sin sesión' });
      req.user = { id: 1, role: rol };
      next();
    },
  };
});

const express = require('express');
const request = require('supertest');
const { pool } = require('../src/config/db');
const pointsService = require('../src/services/pointsService');
const rewardsRoutes = require('../src/routes/rewardsRoutes');

const app = express();
app.use(express.json());
app.use('/api/rewards', rewardsRoutes);
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

describe('GET /api/rewards/revisiones', () => {
  beforeEach(() => jest.clearAllMocks());

  test('lista las conversiones en revisión con el correo enmascarado', async () => {
    pool.query.mockResolvedValue({
      rows: [
        {
          id: 'c-1',
          motivo_revision: 'Misma IP o dispositivo que quien la invitó',
          referente: 'Ana',
          invitada: 'Bea',
          invitada_email: 'beatriz@correo.com',
        },
      ],
    });

    const res = await request(app).get('/api/rewards/revisiones').set('x-user-role', 'admin');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    // PII: quien revisa necesita distinguir cuentas, no leer el correo completo.
    expect(res.body.revisiones[0].invitada_email).not.toBe('beatriz@correo.com');
    expect(res.body.revisiones[0].invitada_email).toMatch(/@correo\.com$/);
  });

  test('una cuenta normal recibe 403', async () => {
    const res = await request(app).get('/api/rewards/revisiones').set('x-user-role', 'client');

    expect(res.status).toBe(403);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('POST /api/rewards/revisiones/:id/aprobar', () => {
  let cliente;

  beforeEach(() => {
    jest.clearAllMocks();
    cliente = { query: jest.fn(), release: jest.fn() };
    pool.connect.mockResolvedValue(cliente);
    cliente.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'c-1',
            estado: 'EN_REVISION',
            referrer_user_id: 7,
            order_id: 'o-1',
          },
        ],
      })
      .mockResolvedValue({ rows: [], rowCount: 1 });
    pointsService.acreditar.mockResolvedValue({ acreditado: true, lotId: 'lot-1' });
  });

  test('aprueba, acredita el premio y cierra la conversión', async () => {
    const res = await request(app)
      .post('/api/rewards/revisiones/c-1/aprobar')
      .set('x-user-role', 'admin');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ estado: 'ACREDITADA', puntos: 500 });

    const [args] = pointsService.acreditar.mock.calls[0];
    expect(args).toMatchObject({
      userId: 7,
      puntos: 500,
      origen: 'referido:compra',
      // Se usa el pedido original: si el webhook ya hubiera creado el lote,
      // ON CONFLICT impide pagar dos veces.
      referenciaId: 'o-1',
    });

    const update = cliente.query.mock.calls.find(([sql]) =>
      /UPDATE referral_conversions/.test(String(sql))
    );
    expect(update[0]).toMatch(/SET estado = 'ACREDITADA'/);
  });

  test('una conversión que ya no está en revisión responde 409', async () => {
    cliente.query.mockReset();
    cliente.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [{ id: 'c-1', estado: 'ACREDITADA', referrer_user_id: 7, order_id: 'o-1' }],
      })
      .mockResolvedValue({ rows: [], rowCount: 1 });

    const res = await request(app)
      .post('/api/rewards/revisiones/c-1/aprobar')
      .set('x-user-role', 'admin');

    expect(res.status).toBe(409);
    expect(pointsService.acreditar).not.toHaveBeenCalled();
  });

  test('una conversión inexistente responde 404', async () => {
    cliente.query.mockReset();
    cliente.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rows: [], rowCount: 1 });

    const res = await request(app)
      .post('/api/rewards/revisiones/no-existe/aprobar')
      .set('x-user-role', 'admin');

    expect(res.status).toBe(404);
  });
});

describe('POST /api/rewards/revisiones/:id/rechazar', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rechaza y deja el motivo', async () => {
    pool.query.mockResolvedValue({ rowCount: 1, rows: [{ id: 'c-1' }] });

    const res = await request(app)
      .post('/api/rewards/revisiones/c-1/rechazar')
      .set('x-user-role', 'admin')
      .send({ motivo: 'Cuentas creadas desde el mismo dispositivo' });

    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('RECHAZADA');
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/SET estado = 'RECHAZADA'/);
    expect(params[1]).toMatch(/mismo dispositivo/);
  });

  test('si no estaba en revisión responde 409', async () => {
    pool.query.mockResolvedValue({ rowCount: 0, rows: [] });

    const res = await request(app)
      .post('/api/rewards/revisiones/c-1/rechazar')
      .set('x-user-role', 'admin')
      .send({});

    expect(res.status).toBe(409);
  });
});

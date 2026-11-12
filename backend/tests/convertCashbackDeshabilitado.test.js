// backend/tests/convertCashbackDeshabilitado.test.js
//
// D-03 (aprobada 2026-11-12): el canje de XP por cashback queda apagado porque
// acreditaba `perfiles_prestador.saldo_disponible`, que es saldo retirable — dinero
// real por fuera de Wompi. El canje válido es el descuento en producto.
//
// Este test evita que la ruta se reactive por descuido: si alguien vuelve a
// montar el canje viejo, aquí se cae.
jest.mock('../src/config/db', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../src/middleware/auth', () => ({
  authMiddleware: (req, res, next) => {
    if (!req.headers['x-user-id']) return res.status(401).json({ error: 'sin sesión' });
    req.user = { id: Number(req.headers['x-user-id']), role: 'client' };
    next();
  },
}));

const express = require('express');
const request = require('supertest');
const { pool } = require('../src/config/db');
const xpLogRoutes = require('../src/routes/xpLogRoutes');

const app = express();
app.use(express.json());
app.use('/api/xp-logs', xpLogRoutes);
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

describe('POST /api/xp-logs/convert-cashback', () => {
  beforeEach(() => jest.clearAllMocks());

  test('responde 410 y no toca la base ni la billetera', async () => {
    const res = await request(app)
      .post('/api/xp-logs/convert-cashback')
      .set('x-user-id', '7')
      .send({});

    expect(res.status).toBe(410);
    expect(res.body.error).toBe('CANJE_CASHBACK_DESHABILITADO');
    expect(res.body.saldo_puntos).toBe('/api/rewards/points');
    expect(pool.query).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('sin sesión responde 401, no 410', async () => {
    const res = await request(app).post('/api/xp-logs/convert-cashback').send({});

    expect(res.status).toBe(401);
  });
});

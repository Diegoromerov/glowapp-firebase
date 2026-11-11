// backend/tests/socialShare.test.js
// POST /api/social/log-share: la ruta que el cliente llamaba y no existía.
// Se verifica el registro, el XP REAL en xp_logs y que reintentar el mismo día
// no lo duplique. La tabla es social_shares_log (migración 008), no una nueva.
jest.mock('../src/config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    const id = req.headers['x-user-id'];
    if (id === 'anon') {
      return _res.status(401).json({ error: 'No autorizado' });
    }
    req.user = { id: Number(id || 7), role: 'client' };
    next();
  },
}));

const express = require('express');
const request = require('supertest');
const { pool } = require('../src/config/db');
const socialRoutes = require('../src/routes/socialRoutes');

const app = express();
app.use(express.json());
app.use('/api/social', socialRoutes);
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

describe('POST /api/social/log-share', () => {
  beforeEach(() => jest.clearAllMocks());

  test('sin sesión responde 401 y no escribe nada', async () => {
    const res = await request(app)
      .post('/api/social/log-share')
      .set('x-user-id', 'anon')
      .send({ platform: 'TIKTOK', content_type: 'AI_COLORIMETRY' });

    expect(res.status).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('una plataforma fuera de la lista se rechaza con 400', async () => {
    const res = await request(app)
      .post('/api/social/log-share')
      .send({ platform: 'MYSPACE', content_type: 'AI_COLORIMETRY' });

    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('un content_type inválido se rechaza con 400', async () => {
    const res = await request(app)
      .post('/api/social/log-share')
      .send({ platform: 'TIKTOK', content_type: 'minúsculas con espacios' });

    expect(res.status).toBe(400);
  });

  test('el primer compartir del día registra la fila y otorga 50 XP', async () => {
    pool.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'sh-1' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const res = await request(app)
      .post('/api/social/log-share')
      .send({
        platform: 'tiktok',
        content_type: 'AI_COLORIMETRY',
        share_reference_id: 'res-42',
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, duplicate: false, xp_awarded: 50 });

    const [insertSql, insertParams] = pool.query.mock.calls[0];
    expect(insertSql).toMatch(/INSERT INTO social_shares_log/);
    expect(insertSql).toMatch(/ON CONFLICT/);
    expect(insertParams).toEqual([7, 'TIKTOK', 'AI_COLORIMETRY', 'res-42']);

    const [xpSql, xpParams] = pool.query.mock.calls[1];
    expect(xpSql).toMatch(/INSERT INTO xp_logs/);
    expect(xpParams).toEqual([7, 50, 'share:AI_COLORIMETRY']);

    const [updateSql, updateParams] = pool.query.mock.calls[2];
    expect(updateSql).toMatch(/UPDATE social_shares_log SET points_awarded/);
    expect(updateParams).toEqual([50, 'sh-1']);
  });

  test('repetir el mismo contenido el mismo día no vuelve a dar XP', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = await request(app)
      .post('/api/social/log-share')
      .send({ platform: 'INSTAGRAM', content_type: 'AI_COLORIMETRY' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, duplicate: true, xp_awarded: 0 });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('si la base falla responde 500 y no miente con el XP', async () => {
    pool.query.mockRejectedValueOnce(new Error('conexión caída'));

    const res = await request(app)
      .post('/api/social/log-share')
      .send({ platform: 'SISTEMA', content_type: 'PROVIDER_PROFILE' });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body).not.toHaveProperty('xp_awarded');
  });

  test('el share de un producto de GlowShop se acepta', async () => {
    pool.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'sh-2' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const res = await request(app)
      .post('/api/social/log-share')
      .send({ platform: 'WHATSAPP', content_type: 'PRODUCT', share_reference_id: '7' });

    expect(res.status).toBe(201);
    expect(res.body.xp_awarded).toBe(50);
  });
});

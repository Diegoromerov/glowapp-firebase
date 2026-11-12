// backend/tests/referralLink.test.js
//
// El enlace corto de invitación cuenta el clic y redirige al registro. Es el
// primer escalón del embudo: sin él no hay costo por clienta adquirida ni forma
// de saber qué invitaciones se abren.
jest.mock('../src/config/db', () => ({ pool: { query: jest.fn() } }));

const express = require('express');
const request = require('supertest');
const { pool } = require('../src/config/db');
const referralLinkRoutes = require('../src/routes/referralLinkRoutes');

const app = express();
app.use('/r', referralLinkRoutes);

describe('GET /r/:codigo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rowCount: 1, rows: [] });
  });

  test('cuenta el clic y redirige al registro con el código normalizado', async () => {
    const res = await request(app).get('/r/  glowab12 ').set('User-Agent', 'jest');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/#/register?ref=GLOWAB12');

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO referral_clicks/);
    expect(params[0]).toBe('GLOWAB12');
    // Se guarda el hash de la IP y del user-agent, nunca el valor en claro.
    expect(params[1]).toMatch(/^[a-f0-9]{64}$/);
    expect(params[2]).toMatch(/^[a-f0-9]{64}$/);
  });

  test('un código inválido no se cuenta y no rompe la redirección', async () => {
    const res = await request(app).get('/r/ab');

    expect(res.status).toBe(302);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('si el contador falla, la invitación sigue funcionando', async () => {
    pool.query.mockRejectedValueOnce(new Error('tabla caída'));

    const res = await request(app).get('/r/GLOWAB12');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('ref=GLOWAB12');
  });
});

describe('orden de montaje en index.js', () => {
  // Este test existe por un bug real: la ruta se montó DESPUÉS del catch-all de la
  // SPA y en producción `/r/CODIGO` devolvía el index de Flutter con 200. El
  // contador nunca corría y no había ningún error que lo delatara.
  test('`/r` se monta antes del catch-all que sirve el index de la SPA', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

    const posRuta = src.indexOf("app.use('/r'");
    const posSpa = src.indexOf('public/index.html');

    expect(posRuta).toBeGreaterThan(-1);
    expect(posSpa).toBeGreaterThan(-1);
    expect(posRuta).toBeLessThan(posSpa);
  });
});

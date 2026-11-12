// El alta tiene que dejar inquilino (P1 del 2026-11-12).
//
// `authMiddleware` sólo fija el contexto RLS cuando el usuario tiene tenant_id.
// Un recién registrado con tenant_id NULL veía «Producto no encontrado» en el
// checkout: no podía comprar, y por tanto el invitado de una referida nunca
// convertía. Este test fija que el INSERT del registro asigne inquilino.
jest.mock('../src/config/db', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../src/config/tenantRouting', () => ({
  runAsSystem: (_deps, fn) => fn(_deps.pool),
}));

const express = require('express');
const request = require('supertest');
const { pool } = require('../src/config/db');
const authController = require('../src/controllers/authController');

const app = express();
app.use(express.json());
app.post('/register', authController.register);
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

describe('POST /api/auth/register', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 10, nombre: 'Prueba', email: 'p@test.local', rol: 'CLIENTE', onboarding_completo: true }],
      })
      .mockResolvedValue({ rows: [], rowCount: 1 });
  });

  test('el INSERT del usuario asigna tenant_id de plataforma, nunca NULL', async () => {
    const res = await request(app).post('/register').send({
      full_name: 'Prueba',
      email: 'p@test.local',
      password: 'ClaveLarga123!',
    });

    expect(res.status).toBe(201);

    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO usuarios/);
    expect(sql).toMatch(/tenant_id/);
    // La misma regla que usa createOrder como respaldo: inquilino de plataforma.
    expect(sql).toMatch(/app_platform_tenant_id\(\)/);
  });
});

// CI-48 — la compuerta de administración de disputas no puede abrirse por el email.
//
// Antes de esta prueba, `requireAdmin` (backend/src/routes/paymentRoutes.js) daba
// administrador a cualquier usuario cuyo email fuese 'admin@beautyapp.com' o 'admin',
// aunque su rol en la base fuese PRESTADOR o CLIENTE. Combinado con la credencial
// publicada en backend/seed.sql y la cuenta activa en producción desde 2026-09-02,
// eso habilitaba resolver disputas (mover dinero) con un rol que no es ADMIN.
//
// La compuerta debe depender del ROL de la base, nunca del email.
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../config/jwt');

jest.mock('../config/db', () => ({
  pool: { query: jest.fn(), connect: jest.fn() }
}));
jest.mock('../config/redis', () => ({ isReady: false, get: jest.fn(), on: jest.fn() }));

const paymentRoutes = require('../routes/paymentRoutes');
const { pool } = require('../config/db');

const app = express();
app.use(express.json());
app.use('/api', paymentRoutes);

const tokenPara = (email) => jwt.sign({ id: 1, email, role: 'prestador' }, getJwtSecret());

function responderConUsuario(rol, email) {
  pool.query.mockImplementation((queryText) => {
    const q = String(queryText);
    // El middleware resuelve la identidad con la función SECURITY DEFINER
    // `app_usuario_identidad($1)` (migración 068), NO con una lectura directa de
    // `usuarios` (esa ruta provoca 401 global bajo RLS+FORCE). Sin esta rama el
    // mock no matcheaba, auth no obtenía usuario y el endpoint devolvía 401 en vez
    // del 403 que este test verifica.
    if (q.includes('app_usuario_identidad')) {
      return Promise.resolve({ rows: [{ rol, tenant_id: 1 }] });
    }
    if (q.includes('SELECT rol, tenant_id FROM usuarios')) {
      return Promise.resolve({ rows: [{ rol, tenant_id: 1 }] });
    }
    if (q.includes('SELECT rol, email FROM usuarios')) {
      return Promise.resolve({ rows: [{ rol, email }] });
    }
    if (q.includes('SELECT rol FROM usuarios')) {
      return Promise.resolve({ rows: [{ rol }] });
    }
    if (q.includes('set_config')) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });
}

const auth = (email) => ({ Authorization: `Bearer ${tokenPara(email)}` });

describe('CI-48 — la compuerta de admin no se abre por el email', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('un PRESTADOR con email admin@beautyapp.com recibe 403 al listar disputas', async () => {
    responderConUsuario('PRESTADOR', 'admin@beautyapp.com');

    const res = await request(app).get('/api/admin/disputes').set(auth('admin@beautyapp.com'));

    expect(res.statusCode).toBe(403);
  });

  test("un PRESTADOR con email 'admin' recibe 403 al listar disputas", async () => {
    responderConUsuario('PRESTADOR', 'admin');

    const res = await request(app).get('/api/admin/disputes').set(auth('admin'));

    expect(res.statusCode).toBe(403);
  });

  test('un CLIENTE con email admin@beautyapp.com recibe 403 al resolver una disputa', async () => {
    responderConUsuario('CLIENTE', 'admin@beautyapp.com');

    const res = await request(app)
      .put('/api/admin/disputes/1/resolve')
      .set(auth('admin@beautyapp.com'))
      .send({ resolucion: 'REEMBOLSO_TOTAL' });

    expect(res.statusCode).toBe(403);
  });

  test('un ADMIN real pasa la compuerta (no recibe 403)', async () => {
    responderConUsuario('ADMIN', 'admin@glow.app');

    const res = await request(app).get('/api/admin/disputes').set(auth('admin@glow.app'));

    expect(res.statusCode).not.toBe(403);
  });
});

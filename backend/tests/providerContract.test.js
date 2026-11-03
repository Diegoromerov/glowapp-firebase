// El contrato del prestador consultaba `responsable_iva` y
// `rut_responsabilidad_codigo` en `perfiles_prestador`, donde no existen: esas
// columnas viven en `usuarios` desde las migraciones 086 y 087. Resultado en
// producción: 500 en GET y en POST, así que ningún prestador podía ver ni
// aceptar el contrato, y sin contrato no hay retiro.
//
// Estas pruebas fijan dos cosas: que las rutas respondan 200 y que la consulta
// siga leyendo las columnas fiscales de `usuarios` (si alguien la devuelve a
// `perfiles_prestador`, el 500 vuelve).

jest.mock('../src/config/db', () => ({
  pool: { query: jest.fn(), connect: jest.fn() }
}));

jest.mock('../src/middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.user = { id: 3, rol: 'PRESTADOR' };
    next();
  }
}));

const express = require('express');
const request = require('supertest');
const { pool } = require('../src/config/db');
const router = require('../src/routes/providerRoutes');

const app = express();
app.use(express.json());
app.use('/api', router);
// El router se monta desnudo en la prueba: sin este manejador, cualquier throw
// se convierte en un 500 opaco y no se ve la causa.
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

const FILA = {
  contrato_version: '2026-10',
  contrato_aceptado_at: null,
  independencia_aceptada_at: null,
  responsable_iva: false,
  rut_responsabilidad_codigo: '49'
};

beforeEach(() => {
  pool.query.mockReset();
});

describe('F8 — contrato de comisión e independencia', () => {
  test('GET /api/provider/contract responde 200 y reporta si está aceptado', async () => {
    pool.query.mockResolvedValueOnce({ rows: [FILA] });

    const r = await request(app).get('/api/provider/contract');

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ version_actual: '2026-10', aceptado: false });
    expect(r.body).toHaveProperty('responsable_iva');
  });

  test('GET cruza con usuarios: las columnas fiscales no están en perfiles_prestador', async () => {
    pool.query.mockResolvedValueOnce({ rows: [FILA] });

    await request(app).get('/api/provider/contract');

    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/FROM\s+perfiles_prestador\s+p/i);
    expect(sql).toMatch(/JOIN\s+usuarios\s+u/i);
  });

  test('POST /api/provider/contract/accept registra la aceptación', async () => {
    pool.query.mockResolvedValueOnce({ rows: [FILA] });

    const r = await request(app)
      .post('/api/provider/contract/accept')
      .send({ version: '2026-10', independencia: true });

    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body).toHaveProperty('contrato');
  });

  test('POST usa un CTE para leer las columnas fiscales tras el UPDATE', async () => {
    pool.query.mockResolvedValueOnce({ rows: [FILA] });

    await request(app)
      .post('/api/provider/contract/accept')
      .send({ version: '2026-10', independencia: true });

    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/WITH\s+actualizado\s+AS/i);
    expect(sql).toMatch(/JOIN\s+usuarios\s+u/i);
    // Un RETURNING con columnas de otra tabla es exactamente el error original:
    // el CTE devuelve * y las fiscales se leen del JOIN, no del UPDATE.
    expect(sql).toMatch(/RETURNING\s+\*/i);
    expect(sql).toMatch(/u\.responsable_iva/i);
  });

  test('POST sin la cláusula de independencia se rechaza con 400', async () => {
    const r = await request(app)
      .post('/api/provider/contract/accept')
      .send({ version: '2026-10' });

    expect(r.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('GET con perfil inexistente devuelve 404', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const r = await request(app).get('/api/provider/contract');

    expect(r.status).toBe(404);
  });
});

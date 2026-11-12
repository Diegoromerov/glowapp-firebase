// backend/tests/rewardsEndpoints.test.js
//
// HTTP de GET /api/rewards/points con la base mockeada. Verifica el contrato que
// consumirá la app: saldo, equivalente en pesos y las reglas del canje servidas
// desde el backend, para que el cliente no las tenga escritas a mano.
jest.mock('../src/config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/middleware/auth', () => ({
  // Imita al middleware real: sin usuario en el token, 401.
  authMiddleware: (req, res, next) => {
    const id = req.headers['x-user-id'];
    if (!id) return res.status(401).json({ error: 'Token no proporcionado' });
    req.user = { id: Number(id), role: 'client' };
    next();
  },
  // Las rutas de administración del programa (reporte y revisión antifraude) usan
  // este middleware del mismo módulo. Sin él aquí, montar la ruta revienta con
  // «Route.get() requires a callback function» y la suite entera no carga.
  adminMiddleware: (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'no autenticado' });
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'solo admin' });
    next();
  },
}));

const express = require('express');
const request = require('supertest');
const { pool } = require('../src/config/db');
const rewardsRoutes = require('../src/routes/rewardsRoutes');

const app = express();
app.use(express.json());
app.use('/api/rewards', rewardsRoutes);
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

function respuestasSaldo({ saldo = '0', porVencer = '0', enEspera = '0', lotes = [] } = {}) {
  pool.query
    .mockResolvedValueOnce({ rows: [{ saldo, por_vencer: porVencer }] })
    .mockResolvedValueOnce({ rows: [{ en_espera: enEspera }] })
    .mockResolvedValueOnce({ rows: lotes });
}

describe('GET /api/rewards/points', () => {
  beforeEach(() => jest.clearAllMocks());

  test('devuelve el saldo, su equivalente en pesos y las reglas vigentes', async () => {
    respuestasSaldo({
      saldo: '1200',
      porVencer: '500',
      lotes: [
        {
          id: 'lot-1',
          puntos: 500,
          puntos_restantes: 500,
          origen: 'referido:compra',
          motivo: null,
          creado_en: '2026-11-01T00:00:00.000Z',
          vence_en: '2027-11-01T00:00:00.000Z',
        },
      ],
    });

    const res = await request(app).get('/api/rewards/points').set('x-user-id', '7');

    expect(res.status).toBe(200);
    expect(res.body.saldo).toBe(1200);
    expect(res.body.saldo_en_pesos).toBe(12000);
    expect(res.body.valor_punto_cop).toBe(10);
    expect(res.body.bloque_canje).toBe(100);
    expect(res.body.tope_porcentaje).toBe(15);
    expect(res.body.minimo_pedido).toBe(25000);
    expect(res.body.en_espera).toBe(0);
    expect(res.body.lotes).toHaveLength(1);
    expect(res.body.lotes[0]).toMatchObject({ puntos: 500, origen: 'referido:compra' });

    // El saldo se consulta siempre por la persona del token, nunca por un id del
    // cuerpo o de la ruta.
    expect(pool.query.mock.calls[0][1]).toEqual([7]);
  });

  test('sin sesión responde 401 y no consulta la base', async () => {
    const res = await request(app).get('/api/rewards/points');

    expect(res.status).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('una usuaria sin puntos recibe ceros, no un error', async () => {
    respuestasSaldo();

    const res = await request(app).get('/api/rewards/points').set('x-user-id', '7');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ saldo: 0, saldo_en_pesos: 0, en_espera: 0, por_vencer: [], lotes: [] });
  });
});

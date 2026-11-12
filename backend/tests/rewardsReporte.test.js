// Reporte de gestión del programa (F2).
//
// Son cifras del negocio: si el endpoint se abre a una cuenta normal, cualquiera
// ve cuánto pasivo tiene la plataforma. El guard es parte del contrato.
jest.mock('../src/config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/middleware/auth', () => {
  const actual = jest.requireActual('../src/middleware/auth');
  return {
    ...actual,
    // Se conserva el adminMiddleware real: lo que se prueba es su guard.
    authMiddleware: (req, res, next) => {
      const rol = req.headers['x-user-role'];
      if (!rol) return res.status(401).json({ error: 'sin sesión' });
      req.user = { id: Number(req.headers['x-user-id'] || 1), role: rol };
      next();
    },
  };
});

const express = require('express');
const request = require('supertest');
const { pool } = require('../src/config/db');
const rewardsRoutes = require('../src/routes/rewardsRoutes');

const app = express();
app.use(express.json());
app.use('/api/rewards', rewardsRoutes);
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

const filaReporte = {
  emitidos_mes: '500',
  emitidos_total: '2000',
  vivos: '1200',
  vencidos: '300',
  canjeados_mes: '300',
  canjeados_total: '800',
  en_espera_movimientos: '100',
  lotes_avisados: '2',
};

describe('GET /api/rewards/reporte', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [filaReporte] });
  });

  test('un admin ve emisión, canje, vivos, vencidos y el pasivo en pesos', async () => {
    const res = await request(app)
      .get('/api/rewards/reporte')
      .set('x-user-role', 'admin')
      .set('x-user-id', '1');

    expect(res.status).toBe(200);
    expect(res.body.mes).toEqual({ emitidos: 500, canjeados: 300 });
    expect(res.body.total).toEqual({ emitidos: 2000, canjeados: 800, en_espera: 100 });
    expect(res.body.saldo.vivos).toBe(1200);
    expect(res.body.saldo.vencidos).toBe(300);
    // El pasivo es el saldo vivo en pesos: 1.200 puntos × $10.
    expect(res.body.saldo.pasivo_pesos).toBe(12000);
    // 800 canjeados sobre 2.000 emitidos.
    expect(res.body.saldo.tasa_canje).toBe(40);
    expect(res.body.avisos.lotes_avisados).toBe(2);
    expect(res.body.valor_punto_cop).toBe(10);
  });

  test('una cuenta normal recibe 403 y no se consulta la base', async () => {
    const res = await request(app).get('/api/rewards/reporte').set('x-user-role', 'client');

    expect(res.status).toBe(403);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('sin sesión responde 401', async () => {
    const res = await request(app).get('/api/rewards/reporte');

    expect(res.status).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('sin puntos emitidos la tasa de canje es 0, no NaN', async () => {
    pool.query.mockResolvedValue({
      rows: [{ emitidos_mes: '0', emitidos_total: '0', vivos: '0', canjeados_mes: '0', canjeados_total: '0' }],
    });

    const res = await request(app).get('/api/rewards/reporte').set('x-user-role', 'admin');

    expect(res.status).toBe(200);
    expect(res.body.saldo.tasa_canje).toBe(0);
    expect(res.body.saldo.pasivo_pesos).toBe(0);
  });
});

// backend/src/tests/authAdminDB.test.js
const jwt = require('jsonwebtoken');

describe('T-A0: Validación en BD para authAdmin Middleware', () => {
  let authAdmin;
  let pool;
  const validSecret = 'secreto_super_seguro_para_pruebas_unitarias_32chars';

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = validSecret;
    pool = require('../config/db').pool;
    authAdmin = require('../modules/admin-glow/authAdmin.middleware');
  });

  afterAll(async () => {
    // Si la conexión estuvo abierta, cerrar el pool
  });

  test('Rechaza peticiones sin encabezado Authorization Bearer con 401', async () => {
    const req = { headers: {} };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await authAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('Rechaza con 403 si el rol retornado por la BD no es ADMIN (incluso si el token decía ADMIN)', async () => {
    const token = jwt.sign({ id: 9999, rol: 'ADMIN' }, validSecret);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    // Mockear la consulta a la BD para que devuelva rol 'CLIENTE' (usuario degradado en BD)
    const originalQuery = pool.query;
    pool.query = jest.fn().mockResolvedValue({
      rows: [{ rol: 'CLIENTE', tenant_id: null }]
    });

    try {
      await authAdmin(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    } finally {
      pool.query = originalQuery;
    }
  });

  test('Permite acceso si el token es válido y la BD confirma que el rol es ADMIN, y asigna req.admin.tenant_id desde la BD', async () => {
    const token = jwt.sign({ id: 1, email: 'admin@glowapp.com', rol: 'ADMIN' }, validSecret);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    const originalQuery = pool.query;
    pool.query = jest.fn().mockResolvedValue({
      rows: [{ rol: 'ADMIN', tenant_id: 105 }]
    });

    try {
      await authAdmin(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.admin).toBeDefined();
      expect(req.admin.rol).toBe('ADMIN');
      expect(req.admin.tenant_id).toBe(105);
    } finally {
      pool.query = originalQuery;
    }
  });
});

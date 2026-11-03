const request = require('supertest');
const express = require('express');
const productRoutes = require('../routes/productRoutes');
const { pool } = require('../config/db');
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../config/jwt');

jest.mock('../config/db', () => ({
  pool: {
    query: jest.fn()
  }
}));

const app = express();
app.use(express.json());
app.use('/api', productRoutes);

/**
 * GET /api/admin/products es el listado paginado que consume el panel admin
 * (admin-dashboard/src/app/(dashboard)/admin/productos/page.tsx). Antes solo
 * existian POST/PUT/DELETE en esa ruta, asi que el listado caia en el 404
 * generico del backend: "Ruta API no encontrada: GET /api/admin/products".
 */
describe('GET /api/admin/products (listado admin)', () => {
  const secret = getJwtSecret();
  const adminToken = jwt.sign({ id: 1, email: 'admin@test.com', role: 'admin' }, secret);
  const clientToken = jwt.sign({ id: 2, email: 'client@test.com', role: 'client' }, secret);

  const IDENTITY = (q) => q.includes('app_usuario_identidad') || q.includes('FROM usuarios');

  function mockPool(rol) {
    pool.query.mockImplementation((queryText) => {
      const q = String(queryText);
      if (IDENTITY(q)) {
        return Promise.resolve({ rows: [{ rol, tenant_id: 1 }] });
      }
      if (q.includes('set_config')) {
        return Promise.resolve({ rows: [] });
      }
      if (q.includes('SELECT COUNT')) {
        return Promise.resolve({ rows: [{ total: 3 }] });
      }
      if (q.includes('FROM productos p')) {
        return Promise.resolve({
          rows: [
            {
              id: 101,
              nombre: 'Shampoo Test',
              descripcion: 'Shampoo de prueba',
              costo: '15000.00',
              stock: 10,
              imagen_url: null,
              tag_especialidad: 'cabello',
              tipo_visibilidad: 'PUBLICO',
              sku: 'SH-01',
              tenant_id: 1
            }
          ]
        });
      }
      return Promise.resolve({ rows: [] });
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Rechaza peticiones sin autenticacion (401)', async () => {
    const res = await request(app).get('/api/admin/products');
    expect(res.statusCode).toBe(401);
  });

  test('Rechaza rol client con 403', async () => {
    mockPool('CLIENTE');

    const res = await request(app)
      .get('/api/admin/products')
      .set('Authorization', `Bearer ${clientToken}`);

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');
  });

  test('Rol admin recibe { data, total } con los campos del panel', async () => {
    mockPool('ADMIN');

    const res = await request(app)
      .get('/api/admin/products?page=1&limit=20')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(3);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(1);

    // El panel lee data.data || data.filas y data.total || data.count
    expect(res.body.data[0]).toMatchObject({
      id: 101,
      nombre: 'Shampoo Test',
      costo: '15000.00',
      sku: 'SH-01',
      tenant_id: 1
    });

    // La consulta paginada debe usar LIMIT/OFFSET calculados desde page/limit
    const pagedCall = pool.query.mock.calls.find(([q]) =>
      String(q).includes('LIMIT $') && String(q).includes('OFFSET $')
    );
    expect(pagedCall).toBeDefined();
    expect(pagedCall[1]).toEqual([20, 0]);
  });

  test('La paginacion se calcula con page y limit', async () => {
    mockPool('ADMIN');

    const res = await request(app)
      .get('/api/admin/products?page=3&limit=10')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);

    const pagedCall = pool.query.mock.calls.find(([q]) =>
      String(q).includes('LIMIT $') && String(q).includes('OFFSET $')
    );
    expect(pagedCall[1]).toEqual([10, 20]);
  });

  test('limit se acota a 100 para no volcar el catalogo completo', async () => {
    mockPool('ADMIN');

    const res = await request(app)
      .get('/api/admin/products?page=1&limit=100000')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);

    const pagedCall = pool.query.mock.calls.find(([q]) =>
      String(q).includes('LIMIT $') && String(q).includes('OFFSET $')
    );
    expect(pagedCall[1]).toEqual([100, 0]);
  });

  test('page invalido o negativo cae a 1', async () => {
    mockPool('ADMIN');

    const res = await request(app)
      .get('/api/admin/products?page=-5&limit=0')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);

    const pagedCall = pool.query.mock.calls.find(([q]) =>
      String(q).includes('LIMIT $') && String(q).includes('OFFSET $')
    );
    // page=-5 -> 1 ; limit=0 -> 20 (default) ; offset = 0
    expect(pagedCall[1]).toEqual([20, 0]);
  });
});

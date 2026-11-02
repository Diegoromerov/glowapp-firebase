const request = require('supertest');
const express = require('express');
const adminPreciosRoutes = require('../routes/adminPreciosRoutes');
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
app.use('/api/admin', adminPreciosRoutes);

describe('Admin Precios Routes', () => {
  const secret = getJwtSecret();
  const adminToken = jwt.sign({ id: 1, email: 'admin@test.com', role: 'admin' }, secret);
  const clientToken = jwt.sign({ id: 2, email: 'client@test.com', role: 'client' }, secret);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Rechaza peticiones sin autenticación (401)', async () => {
    const res = await request(app).get('/api/admin/precios');
    expect(res.statusCode).toBe(401);
  });

  test('Rechaza peticiones de rol client o provider con 403', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 2, rol: 'CLIENTE', tenant_id: 1 }] });

    const res = await request(app)
      .get('/api/admin/precios')
      .set('Authorization', `Bearer ${clientToken}`);

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');
  });

  test('GET /api/admin/precios funciona correctamente para rol admin', async () => {
    pool.query.mockImplementation((queryText) => {
      const q = String(queryText);
      if (q.includes('app_usuario_identidad') || q.includes('FROM usuarios')) {
        return Promise.resolve({ rows: [{ rol: 'ADMIN', tenant_id: 1 }] });
      }
      if (q.includes('set_config')) {
        return Promise.resolve({ rows: [] });
      }
      if (q.includes('FROM listas_precios')) {
        return Promise.resolve({
          rows: [
            { id: 1, codigo: 'cliente' },
            { id: 2, codigo: 'profesional' },
            { id: 3, codigo: 'negocio' }
          ]
        });
      }
      if (q.includes('SELECT COUNT')) {
        return Promise.resolve({ rows: [{ total: 1 }] });
      }
      if (q.includes('FROM productos p')) {
        return Promise.resolve({
          rows: [
            { producto_id: 101, nombre: 'Shampoo Test', sku: 'SH-01', costo: '15000.00', stock: 10 }
          ]
        });
      }
      if (q.includes('FROM precios_producto')) {
        return Promise.resolve({
          rows: [
            { producto_id: 101, lista_codigo: 'cliente', precio: '25000.00', unidad_minima: 1 }
          ]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get('/api/admin/precios')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.filas.length).toBe(1);
    expect(res.body.filas[0].precios.cliente).toBe(25000);
    expect(res.body.filas[0].precios.profesional).toBeNull();
  });

  test('GET /api/admin/precios/export.csv devuelve CSV con headers correctos', async () => {
    pool.query.mockImplementation((queryText) => {
      const q = String(queryText);
      if (q.includes('app_usuario_identidad') || q.includes('FROM usuarios')) {
        return Promise.resolve({ rows: [{ rol: 'ADMIN', tenant_id: 1 }] });
      }
      if (q.includes('FROM listas_precios')) {
        return Promise.resolve({
          rows: [
            { id: 1, codigo: 'cliente' },
            { id: 2, codigo: 'profesional' },
            { id: 3, codigo: 'negocio' }
          ]
        });
      }
      if (q.includes('FROM productos p')) {
        return Promise.resolve({
          rows: [
            { producto_id: 101, sku: 'SKU1', nombre: 'Prod 1', costo: 1000, stock: 5, precio_cliente: 2000, precio_profesional: null, precio_negocio: null, unidad_minima_negocio: 6 }
          ]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get('/api/admin/precios/export.csv')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain('producto_id,sku,nombre,costo,stock,precio_cliente,precio_profesional,precio_negocio,unidad_minima_negocio');
    expect(res.text).toContain('101,SKU1,Prod 1,1000,5,2000');
  });

  test('POST /api/admin/precios/import.csv procesa archivo CSV en dry_run', async () => {
    pool.query.mockImplementation((queryText) => {
      const q = String(queryText);
      if (q.includes('app_usuario_identidad') || q.includes('FROM usuarios')) {
        return Promise.resolve({ rows: [{ rol: 'ADMIN', tenant_id: 1 }] });
      }
      if (q.includes('FROM listas_precios')) {
        return Promise.resolve({
          rows: [
            { id: 1, codigo: 'cliente' },
            { id: 2, codigo: 'profesional' },
            { id: 3, codigo: 'negocio' }
          ]
        });
      }
      if (q.includes('FROM productos')) {
        return Promise.resolve({
          rows: [{ id: 101, sku: 'SKU1', costo: 1000, stock: 5, tenant_id: 1 }]
        });
      }
      if (q.includes('FROM precios_producto')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const csvContent = 'producto_id,sku,nombre,precio_cliente\n101,SKU1,Prod 1,2500';

    const res = await request(app)
      .post('/api/admin/precios/import.csv?dry_run=true')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('archivo', Buffer.from(csvContent), 'precios.csv');

    expect(res.statusCode).toBe(200);
    expect(res.body.leidas).toBe(1);
    expect(res.body.validas).toBe(1);
    expect(res.body.cambios.nuevos).toBe(1);
  });
});

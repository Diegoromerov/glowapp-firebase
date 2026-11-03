// backend/src/tests/e2eSmoke.test.js
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'secreto_super_seguro_para_pruebas_unitarias_32chars';

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const redisClient = require('../config/redis');
const { pool } = require('../config/db');

const mockBlacklistSet = new Set();

// Configurar el arnés mock directamente con funciones nativas
redisClient.isReady = true;
redisClient.isOpen = true;

redisClient.get = async (key) => {
  const isRev = mockBlacklistSet.has(key);
  return isRev ? 'revoked' : null;
};

redisClient.setEx = async (key, ttl, value) => {
  mockBlacklistSet.add(key);
  return 'OK';
};

const authAdmin = require('../modules/admin-glow/authAdmin.middleware');
const adminAuthRoutes = require('../routes/adminAuthRoutes');

const validSecret = 'secreto_super_seguro_para_pruebas_unitarias_32chars';

describe('T-A1 E2E Smoke Test: Flujo Completo de Autenticación, Acceso a Rutas Admin, Upload y Revocación', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use(express.text({ type: 'text/csv' }));

    // Montar rutas de autenticación admin
    app.use('/api/admin/auth', adminAuthRoutes);

    // Montar ruta protegida simulada de academia/precios
    app.get('/api/admin/academia', authAdmin, (req, res) => {
      res.json({
        success: true,
        data: [
          { id: 1, titulo: 'Curso de Estética Facial Avanzada', estado: 'PUBLICADO' },
          { id: 2, titulo: 'Barbería Profesional y Visagismo', estado: 'BORRADOR' }
        ]
      });
    });

    // Montar ruta protegida simulada de carga de CSV de precios
    app.post('/api/admin/precios/upload-csv', authAdmin, (req, res) => {
      const csvData = req.body;
      res.json({
        success: true,
        message: 'CSV de precios procesado con éxito',
        bytesReceived: csvData ? csvData.length : 0
      });
    });
  });

  beforeEach(() => {
    mockBlacklistSet.clear();
  });

  test('E2E Smoke: Login -> Listar Academia -> Cargar CSV -> Logout -> Verificar 401 en Access y Refresh Tokens Revocados', async () => {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    const originalQuery = pool.query;

    pool.query = jest.fn().mockImplementation((queryText) => {
      if (queryText.includes('FROM usuarios WHERE LOWER(email)')) {
        return Promise.resolve({
          rows: [
            {
              id: 10,
              email: 'admin@glowapp.com',
              nombre: 'Admin Master',
              password_hash: hashedPassword,
              rol: 'ADMIN'
            }
          ]
        });
      }
      if (queryText.includes('app_usuario_identidad')) {
        return Promise.resolve({
          rows: [{ rol: 'ADMIN', tenant_id: 200 }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    try {
      // 1. LOGIN ADMINISTRATIVO
      console.log('--- 1. POST /api/admin/auth/login ---');
      const loginRes = await request(app)
        .post('/api/admin/auth/login')
        .send({ email: 'admin@glowapp.com', password: 'admin123' });

      console.log('HTTP Status:', loginRes.status);
      console.log('Response Body:', JSON.stringify(loginRes.body, null, 2));

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.success).toBe(true);
      const { accessToken, refreshToken, admin } = loginRes.body;
      expect(accessToken).toBeDefined();
      expect(refreshToken).toBeDefined();
      expect(admin.email).toBe('admin@glowapp.com');

      // 2. CONSULTAR RUTA PROTEGIDA (LISTAR ACADEMIA)
      console.log('\n--- 2. GET /api/admin/academia ---');
      const academiaRes = await request(app)
        .get('/api/admin/academia')
        .set('Authorization', `Bearer ${accessToken}`);

      console.log('HTTP Status:', academiaRes.status);
      console.log('Response Body:', JSON.stringify(academiaRes.body, null, 2));

      expect(academiaRes.status).toBe(200);
      expect(academiaRes.body.success).toBe(true);
      expect(academiaRes.body.data.length).toBe(2);

      // 3. CARGAR ARCHIVO CSV DE PRECIOS
      console.log('\n--- 3. POST /api/admin/precios/upload-csv ---');
      const csvPayload = 'id,servicio,precio\n1,Corte,30000\n2,Manicura,20000';
      const uploadRes = await request(app)
        .post('/api/admin/precios/upload-csv')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Content-Type', 'text/csv')
        .send(csvPayload);

      console.log('HTTP Status:', uploadRes.status);
      console.log('Response Body:', JSON.stringify(uploadRes.body, null, 2));

      expect(uploadRes.status).toBe(200);
      expect(uploadRes.body.success).toBe(true);
      expect(uploadRes.body.bytesReceived).toBe(csvPayload.length);

      // 4. LOGOUT ADMINISTRATIVO (REVOCAR ACCESS Y REFRESH TOKENS EN REDIS)
      console.log('\n--- 4. POST /api/admin/auth/logout ---');
      const logoutRes = await request(app)
        .post('/api/admin/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ refreshToken });

      console.log('HTTP Status:', logoutRes.status);
      console.log('Response Body:', JSON.stringify(logoutRes.body, null, 2));

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.success).toBe(true);

      // 5. VERIFICAR QUE EL ACCESS TOKEN REVOCADO DEVUELVE HTTP 401
      console.log('\n--- 5. GET /api/admin/academia (Con Access Token Revocado) ---');
      const revokedAccessRes = await request(app)
        .get('/api/admin/academia')
        .set('Authorization', `Bearer ${accessToken}`);

      console.log('HTTP Status:', revokedAccessRes.status);
      console.log('Response Body:', JSON.stringify(revokedAccessRes.body, null, 2));

      expect(revokedAccessRes.status).toBe(401);
      expect(revokedAccessRes.body.error).toMatch(/Token revocado/i);

      // 6. VERIFICAR QUE EL REFRESH TOKEN REVOCADO DEVUELVE HTTP 401
      console.log('\n--- 6. POST /api/admin/auth/refresh (Con Refresh Token Revocado) ---');
      const revokedRefreshRes = await request(app)
        .post('/api/admin/auth/refresh')
        .send({ refreshToken });

      console.log('HTTP Status:', revokedRefreshRes.status);
      console.log('Response Body:', JSON.stringify(revokedRefreshRes.body, null, 2));

      expect(revokedRefreshRes.status).toBe(401);
      expect(revokedRefreshRes.body.error).toMatch(/Refresh token revocado/i);

    } finally {
      pool.query = originalQuery;
    }
  });
});

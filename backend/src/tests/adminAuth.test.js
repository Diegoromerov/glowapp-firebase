// backend/src/tests/adminAuth.test.js
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const { getJwtSecret } = require('../config/jwt');
const { pool } = require('../config/db');
const redisClient = require('../config/redis');
const authAdmin = require('../modules/admin-glow/authAdmin.middleware');
const adminAuthRoutes = require('../routes/adminAuthRoutes');

const validSecret = 'secreto_super_seguro_para_pruebas_unitarias_32chars';

describe('T-A1 E1: Autenticación Admin (Login, Refresh, Logout, Session, Blacklist, Fail-Closed, 12h Ceiling)', () => {
  let app;

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = validSecret;

    app = express();
    app.use(express.json());
    app.use('/api/admin/auth', adminAuthRoutes);

    // Ruta protegida de prueba con authAdmin
    app.get('/api/admin/protected-test', authAdmin, (req, res) => {
      res.json({ success: true, admin: req.admin });
    });
  });

  beforeEach(async () => {
    jest.clearAllMocks();
  });

  describe('POST /api/admin/auth/login', () => {
    test('Permite login exitoso a usuario con rol ADMIN y genera access (15m) y refresh (8h) con session_start_at', async () => {
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
        const res = await request(app)
          .post('/api/admin/auth/login')
          .send({ email: 'admin@glowapp.com', password: 'admin123' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.accessToken).toBeDefined();
        expect(res.body.refreshToken).toBeDefined();
        expect(res.body.admin).toBeDefined();
        expect(res.body.admin.email).toBe('admin@glowapp.com');
        expect(res.body.admin.rol).toBe('ADMIN');
        expect(res.body.admin.tenant_id).toBe(200);

        // Validar expiración y payloads de tokens
        const decodedAccess = jwt.verify(res.body.accessToken, validSecret);
        expect(decodedAccess.type).toBe('access');
        expect(decodedAccess.rol).toBe('ADMIN');
        expect(decodedAccess.session_start_at).toBeDefined();

        const decodedRefresh = jwt.verify(res.body.refreshToken, validSecret);
        expect(decodedRefresh.type).toBe('refresh');
        expect(decodedRefresh.rol).toBe('ADMIN');
        expect(decodedRefresh.session_start_at).toBeDefined();
      } finally {
        pool.query = originalQuery;
      }
    });

    test('Rechaza login con 401 si la contraseña es incorrecta', async () => {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      const originalQuery = pool.query;

      pool.query = jest.fn().mockImplementation((queryText) => {
        if (queryText.includes('FROM usuarios WHERE LOWER(email)')) {
          return Promise.resolve({
            rows: [{ id: 10, email: 'admin@glowapp.com', password_hash: hashedPassword, rol: 'ADMIN' }]
          });
        }
        return Promise.resolve({ rows: [] });
      });

      try {
        const res = await request(app)
          .post('/api/admin/auth/login')
          .send({ email: 'admin@glowapp.com', password: 'clave_incorrecta' });

        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/Credenciales inválidas/i);
      } finally {
        pool.query = originalQuery;
      }
    });

    test('Rechaza login con 403 si el usuario existe pero la BD indica que NO es ADMIN (ej. CLIENTE)', async () => {
      const hashedPassword = await bcrypt.hash('cliente123', 10);
      const originalQuery = pool.query;

      pool.query = jest.fn().mockImplementation((queryText) => {
        if (queryText.includes('FROM usuarios WHERE LOWER(email)')) {
          return Promise.resolve({
            rows: [{ id: 50, email: 'cliente@glowapp.com', password_hash: hashedPassword, rol: 'CLIENTE' }]
          });
        }
        if (queryText.includes('app_usuario_identidad')) {
          return Promise.resolve({
            rows: [{ rol: 'CLIENTE', tenant_id: null }]
          });
        }
        return Promise.resolve({ rows: [] });
      });

      try {
        const res = await request(app)
          .post('/api/admin/auth/login')
          .send({ email: 'cliente@glowapp.com', password: 'cliente123' });

        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/Se requieren permisos de administrador/i);
      } finally {
        pool.query = originalQuery;
      }
    });
  });

  describe('GET /api/admin/auth/session', () => {
    test('Retorna la información del admin cuando el token Bearer es válido', async () => {
      const accessToken = jwt.sign(
        { id: 10, email: 'admin@glowapp.com', rol: 'ADMIN', role: 'admin', session_start_at: Math.floor(Date.now() / 1000) },
        validSecret,
        { expiresIn: '15m' }
      );

      const originalQuery = pool.query;
      pool.query = jest.fn().mockResolvedValue({
        rows: [{ rol: 'ADMIN', tenant_id: 200 }]
      });

      try {
        const res = await request(app)
          .get('/api/admin/auth/session')
          .set('Authorization', `Bearer ${accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.admin).toBeDefined();
        expect(res.body.admin.email).toBe('admin@glowapp.com');
        expect(res.body.admin.tenant_id).toBe(200);
      } finally {
        pool.query = originalQuery;
      }
    });
  });

  describe('POST /api/admin/auth/refresh y Tope de Sesión (12h)', () => {
    test('Emite nuevo access y refresh token cuando se provee un refresh token válido', async () => {
      const refreshToken = jwt.sign(
        { id: 10, email: 'admin@glowapp.com', rol: 'ADMIN', role: 'admin', type: 'refresh', session_start_at: Math.floor(Date.now() / 1000) },
        validSecret,
        { expiresIn: '8h' }
      );

      const originalQuery = pool.query;
      pool.query = jest.fn().mockResolvedValue({
        rows: [{ rol: 'ADMIN', tenant_id: 200 }]
      });

      try {
        const res = await request(app)
          .post('/api/admin/auth/refresh')
          .send({ refreshToken });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.accessToken).toBeDefined();
        expect(res.body.refreshToken).toBeDefined();

        const newAccess = jwt.verify(res.body.accessToken, validSecret);
        expect(newAccess.type).toBe('access');
      } finally {
        pool.query = originalQuery;
      }
    });

    test('Rechaza con 401 si la sesión supera el tope absoluto de 12 horas', async () => {
      const pastStart = Math.floor(Date.now() / 1000) - (13 * 3600); // 13 horas en el pasado
      const refreshToken = jwt.sign(
        { id: 10, email: 'admin@glowapp.com', rol: 'ADMIN', role: 'admin', type: 'refresh', session_start_at: pastStart },
        validSecret,
        { expiresIn: '8h' }
      );

      const res = await request(app)
        .post('/api/admin/auth/refresh')
        .send({ refreshToken });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/límite máximo 12 horas/i);
    });

    test('Rechaza con 401 en authAdmin si el access token supera el tope de 12 horas', async () => {
      const pastStart = Math.floor(Date.now() / 1000) - (13 * 3600);
      const accessToken = jwt.sign(
        { id: 10, email: 'admin@glowapp.com', rol: 'ADMIN', role: 'admin', type: 'access', session_start_at: pastStart },
        validSecret,
        { expiresIn: '15m' }
      );

      const res = await request(app)
        .get('/api/admin/protected-test')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/límite máximo 12 horas/i);
    });
  });

  describe('Redis Fail-Closed (503 Service Unavailable)', () => {
    test('authAdmin responde 503 si Redis falla durante la verificación de la lista negra', async () => {
      const accessToken = jwt.sign(
        { id: 10, email: 'admin@glowapp.com', rol: 'ADMIN', role: 'admin', type: 'access' },
        validSecret,
        { expiresIn: '15m' }
      );

      const origGet = redisClient.get;
      const origIsReady = redisClient.isReady;
      redisClient.isReady = true;
      redisClient.get = jest.fn().mockRejectedValue(new Error('Redis connection drop'));

      try {
        const res = await request(app)
          .get('/api/admin/protected-test')
          .set('Authorization', `Bearer ${accessToken}`);

        expect(res.status).toBe(503);
        expect(res.body.error).toMatch(/Servicio de autenticación no disponible/i);
      } finally {
        redisClient.get = origGet;
        redisClient.isReady = origIsReady;
      }
    });

    test('refresh responde 503 si Redis falla durante la verificación o registro de la lista negra', async () => {
      const refreshToken = jwt.sign(
        { id: 10, email: 'admin@glowapp.com', rol: 'ADMIN', role: 'admin', type: 'refresh' },
        validSecret,
        { expiresIn: '8h' }
      );

      const origGet = redisClient.get;
      const origIsReady = redisClient.isReady;
      redisClient.isReady = true;
      redisClient.get = jest.fn().mockRejectedValue(new Error('Redis connection drop'));

      try {
        const res = await request(app)
          .post('/api/admin/auth/refresh')
          .send({ refreshToken });

        expect(res.status).toBe(503);
        expect(res.body.error).toMatch(/Servicio de autenticación no disponible/i);
      } finally {
        redisClient.get = origGet;
        redisClient.isReady = origIsReady;
      }
    });
  });

  describe('POST /api/admin/auth/logout y Blacklist en authAdmin', () => {
    test('Revoca access token y refresh token registrándolos en Redis blacklist, bloqueando accesos posteriores', async () => {
      const accessToken = jwt.sign(
        { id: 10, email: 'admin@glowapp.com', rol: 'ADMIN', role: 'admin', type: 'access' },
        validSecret,
        { expiresIn: '15m' }
      );
      const refreshToken = jwt.sign(
        { id: 10, email: 'admin@glowapp.com', rol: 'ADMIN', role: 'admin', type: 'refresh' },
        validSecret,
        { expiresIn: '8h' }
      );

      const origSetEx = redisClient.setEx;
      const origIsReady = redisClient.isReady;
      redisClient.isReady = true;
      const setExMock = jest.fn().mockResolvedValue('OK');
      redisClient.setEx = setExMock;

      try {
        const resLogout = await request(app)
          .post('/api/admin/auth/logout')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ refreshToken });

        expect(resLogout.status).toBe(200);
        expect(resLogout.body.success).toBe(true);
        expect(setExMock).toHaveBeenCalledWith(
          `beauty:token_blacklist:${accessToken}`,
          expect.any(Number),
          'revoked'
        );
        expect(setExMock).toHaveBeenCalledWith(
          `beauty:token_blacklist:${refreshToken}`,
          expect.any(Number),
          'revoked'
        );
      } finally {
        redisClient.setEx = origSetEx;
        redisClient.isReady = origIsReady;
      }
    });

    test('authAdmin rechaza con 401 pases con tokens revocados en Redis blacklist', async () => {
      const accessToken = jwt.sign(
        { id: 10, email: 'admin@glowapp.com', rol: 'ADMIN', role: 'admin' },
        validSecret,
        { expiresIn: '15m' }
      );

      const origGet = redisClient.get;
      const origIsReady = redisClient.isReady;
      redisClient.isReady = true;
      redisClient.get = jest.fn().mockImplementation((key) => {
        if (key === `beauty:token_blacklist:${accessToken}`) {
          return Promise.resolve('revoked');
        }
        return Promise.resolve(null);
      });

      try {
        const res = await request(app)
          .get('/api/admin/protected-test')
          .set('Authorization', `Bearer ${accessToken}`);

        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/Token revocado/i);
      } finally {
        redisClient.get = origGet;
        redisClient.isReady = origIsReady;
      }
    });
  });
});

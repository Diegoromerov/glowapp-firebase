// backend/src/middleware/__tests__/requireAnyRole.test.js
/**
 * Tests para requireAnyRole middleware (Fase 6)
 */

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { requireAnyRole, clientOnly, providerOnly } = require('../requireAnyRole');
const { getJwtSecret } = require('../../config/jwt');

// Helper para crear tokens de prueba
function createToken(payload, secret = getJwtSecret()) {
  return jwt.sign(payload, secret, { expiresIn: '1h' });
}

function createApp() {
  const app = express();
  app.use(express.json());
  
  // Mock auth middleware que inyecta req.user desde token
  app.use((req, res, next) => {
    const authHeader = req.header('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (token) {
      try {
        req.user = jwt.verify(token, getJwtSecret());
      } catch (e) {
        req.user = null;
      }
    }
    next();
  });
  
  return app;
}

describe('requireAnyRole middleware', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    
    // Rutas de prueba
    app.get('/client-only', requireAnyRole('client'), (req, res) => res.json({ ok: true }));
    app.get('/provider-only', requireAnyRole('provider'), (req, res) => res.json({ ok: true }));
    app.get('/admin-only', requireAnyRole('admin'), (req, res) => res.json({ ok: true }));
    app.get('/multi-role', requireAnyRole('client', 'provider'), (req, res) => res.json({ ok: true }));
    app.get('/client-with-audience', requireAnyRole('client', { audience: 'client' }), (req, res) => res.json({ ok: true }));
    app.get('/provider-with-audience', requireAnyRole('provider', { audience: 'provider', requireAudience: true }), (req, res) => res.json({ ok: true }));

    // Helpers preconfigurados
    app.get('/client-helper', clientOnly, (req, res) => res.json({ ok: true }));
    app.get('/provider-helper', providerOnly, (req, res) => res.json({ ok: true }));
  });

  const clientToken = createToken({
    id: 1,
    email: 'client@test.com',
    role: 'client',
    rol: 'CLIENTE',
    roles: ['client']
  });

  const providerToken = createToken({
    id: 2,
    email: 'provider@test.com',
    role: 'provider',
    rol: 'PRESTADOR',
    roles: ['provider', 'owner']
  });

  const adminToken = createToken({
    id: 3,
    email: 'admin@test.com',
    role: 'admin',
    rol: 'ADMIN',
    roles: ['admin']
  });

  const salonToken = createToken({
    id: 4,
    email: 'salon@test.com',
    role: 'salon',
    rol: 'SALON',
    roles: ['salon', 'manager']
  });

  const multiRoleToken = createToken({
    id: 5,
    email: 'multi@test.com',
    role: 'client',
    rol: 'CLIENTE',
    roles: ['client', 'provider']
  });

  test('401 sin autenticación', async () => {
    await request(app)
      .get('/client-only')
      .expect(401);
  });

  test('client accede a endpoint client', async () => {
    await request(app)
      .get('/client-only')
      .set('Authorization', `Bearer ${clientToken}`)
      .expect(200);
  });

  test('client NO accede a endpoint provider', async () => {
    await request(app)
      .get('/provider-only')
      .set('Authorization', `Bearer ${clientToken}`)
      .expect(403);
  });

  test('provider accede a endpoint provider', async () => {
    await request(app)
      .get('/provider-only')
      .set('Authorization', `Bearer ${providerToken}`)
      .expect(200);
  });

  test('admin accede a todo', async () => {
    await request(app)
      .get('/admin-only')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    
    await request(app)
      .get('/client-only')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    
    await request(app)
      .get('/provider-only')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  test('multi-role (client+provider) accede a ambos', async () => {
    await request(app)
      .get('/client-only')
      .set('Authorization', `Bearer ${multiRoleToken}`)
      .expect(200);
    
    await request(app)
      .get('/provider-only')
      .set('Authorization', `Bearer ${multiRoleToken}`)
      .expect(200);
  });

  test('multi-role endpoint con OR lógico', async () => {
    await request(app)
      .get('/multi-role')
      .set('Authorization', `Bearer ${clientToken}`)
      .expect(200);
    
    await request(app)
      .get('/multi-role')
      .set('Authorization', `Bearer ${providerToken}`)
      .expect(200);
  });

  test('validación X-App-Audience - cliente correcto', async () => {
    await request(app)
      .get('/client-with-audience')
      .set('Authorization', `Bearer ${clientToken}`)
      .set('X-App-Audience', 'client')
      .expect(200);
  });

  test('validación X-App-Audience - cliente incorrecto', async () => {
    await request(app)
      .get('/client-with-audience')
      .set('Authorization', `Bearer ${clientToken}`)
      .set('X-App-Audience', 'provider')
      .expect(403);
  });

  test('validación X-App-Audience requerida - sin header', async () => {
    await request(app)
      .get('/provider-with-audience')
      .set('Authorization', `Bearer ${providerToken}`)
      .expect(400);
  });

  test('validación X-App-Audience requerida - con header correcto', async () => {
    await request(app)
      .get('/provider-with-audience')
      .set('Authorization', `Bearer ${providerToken}`)
      .set('X-App-Audience', 'provider')
      .expect(200);
  });

  test('helper clientOnly funciona', async () => {
    await request(app)
      .get('/client-helper')
      .set('Authorization', `Bearer ${clientToken}`)
      .set('X-App-Audience', 'client')
      .expect(200);
  });

  test('helper providerOnly funciona', async () => {
    await request(app)
      .get('/provider-helper')
      .set('Authorization', `Bearer ${providerToken}`)
      .set('X-App-Audience', 'provider')
      .expect(200);
  });

  test('helper clientOnly rechaza provider', async () => {
    await request(app)
      .get('/client-helper')
      .set('Authorization', `Bearer ${providerToken}`)
      .set('X-App-Audience', 'provider')
      .expect(403);
  });

  test('adjunta authContext en req', async () => {
    let capturedContext = null;
    app.get('/capture-context', requireAnyRole('client'), (req, res) => {
      capturedContext = req.authContext;
      res.json({ ok: true });
    });

    await request(app)
      .get('/capture-context')
      .set('Authorization', `Bearer ${clientToken}`)
      .expect(200);

    expect(capturedContext).toBeDefined();
    expect(capturedContext.allowedRoles).toContain('client');
    expect(capturedContext.matchedRole).toBe('client');
    expect(capturedContext.userRoles).toContain('client');
  });

  test('roles[] del JWT tiene prioridad sobre role simple', async () => {
    // Token con role='client' pero roles=['provider']
    const conflictingToken = createToken({
      id: 6,
      email: 'conflict@test.com',
      role: 'client',
      rol: 'CLIENTE',
      roles: ['provider'] // JWT dice provider
    });

    // Debería permitir acceso a provider (roles[] tiene prioridad)
    await request(app)
      .get('/provider-only')
      .set('Authorization', `Bearer ${conflictingToken}`)
      .expect(200);
  });

  test('salon accede a endpoints de provider', async () => {
    await request(app)
      .get('/provider-only')
      .set('Authorization', `Bearer ${salonToken}`)
      .expect(200);
  });
});

describe('requireAnyRole - validación de parámetros', () => {
  test('lanza error sin roles permitidos', () => {
    expect(() => requireAnyRole()).toThrow('se requiere al menos un rol permitido');
  });
});
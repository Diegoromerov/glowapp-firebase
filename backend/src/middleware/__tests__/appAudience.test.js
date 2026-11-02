// backend/src/middleware/__tests__/appAudience.test.js
/**
 * Tests para appAudience middleware (Fase 6)
 */

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { 
  validateAppAudience, 
  clientAppOnly, 
  providerAppOnly,
  requireRoleAndAudience,
  VALID_AUDIENCES 
} = require('../appAudience');
const { getJwtSecret } = require('../../config/jwt');

function createToken(payload, secret = getJwtSecret()) {
  return jwt.sign(payload, secret, { expiresIn: '1h' });
}

function createApp() {
  const app = express();
  app.use(express.json());
  
  // Mock auth middleware
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

describe('validateAppAudience middleware', () => {
  let app;

  beforeEach(() => {
    app = createApp();

    // Rutas de prueba
    app.get('/client-only', validateAppAudience({ allowed: 'client' }), (req, res) => res.json({ ok: true, audience: req.appAudience }));
    app.get('/provider-only', validateAppAudience({ allowed: 'provider' }), (req, res) => res.json({ ok: true, audience: req.appAudience }));
    app.get('/multi-audience', validateAppAudience({ allowed: ['client', 'provider'] }), (req, res) => res.json({ ok: true, audience: req.appAudience }));
    app.get('/optional-audience', validateAppAudience({ allowed: 'client', required: false }), (req, res) => res.json({ ok: true, audience: req.appAudience }));
    app.get('/enforce-consistency', validateAppAudience({ allowed: ['provider', 'client'], enforceRoleConsistency: true }), (req, res) => res.json({ ok: true, audience: req.appAudience }));

    // Helpers
    app.get('/client-helper', clientAppOnly, (req, res) => res.json({ ok: true }));
    app.get('/provider-helper', providerAppOnly, (req, res) => res.json({ ok: true }));
  });

  const clientToken = createToken({
    id: 1,
    email: 'client@test.com',
    role: 'client',
    roles: ['client']
  });

  const providerToken = createToken({
    id: 2,
    email: 'provider@test.com',
    role: 'provider',
    roles: ['provider', 'owner']
  });

  test('400 sin header cuando required=true (default)', async () => {
    await request(app)
      .get('/client-only')
      .set('Authorization', `Bearer ${clientToken}`)
      .expect(400);
  });

  test('200 con header correcto', async () => {
    await request(app)
      .get('/client-only')
      .set('Authorization', `Bearer ${clientToken}`)
      .set('X-App-Audience', 'client')
      .expect(200);
  });

  test('403 con header incorrecto', async () => {
    await request(app)
      .get('/client-only')
      .set('Authorization', `Bearer ${clientToken}`)
      .set('X-App-Audience', 'provider')
      .expect(403);
  });

  test('múltiples audiencias permitidas', async () => {
    await request(app)
      .get('/multi-audience')
      .set('Authorization', `Bearer ${clientToken}`)
      .set('X-App-Audience', 'client')
      .expect(200);

    await request(app)
      .get('/multi-audience')
      .set('Authorization', `Bearer ${providerToken}`)
      .set('X-App-Audience', 'provider')
      .expect(200);
  });

  test('required=false permite sin header', async () => {
    await request(app)
      .get('/optional-audience')
      .set('Authorization', `Bearer ${clientToken}`)
      .expect(200);
  });

  test('required=false con header correcto', async () => {
    await request(app)
      .get('/optional-audience')
      .set('Authorization', `Bearer ${clientToken}`)
      .set('X-App-Audience', 'client')
      .expect(200);
  });

  test('enforceRoleConsistency - warning si incoherente (no bloquea)', async () => {
    // provider token con audience client (incoherente)
    // Debería pasar pero loggear warning
    await request(app)
      .get('/enforce-consistency')
      .set('Authorization', `Bearer ${providerToken}`)
      .set('X-App-Audience', 'client')
      .expect(200);
  });

  test('helper clientAppOnly', async () => {
    await request(app)
      .get('/client-helper')
      .set('Authorization', `Bearer ${clientToken}`)
      .set('X-App-Audience', 'client')
      .expect(200);
  });

  test('helper providerAppOnly', async () => {
    await request(app)
      .get('/provider-helper')
      .set('Authorization', `Bearer ${providerToken}`)
      .set('X-App-Audience', 'provider')
      .expect(200);
  });

  test('adjunta appAudience en req', async () => {
    let capturedAudience = null;
    app.get('/capture', validateAppAudience({ allowed: 'client' }), (req, res) => {
      capturedAudience = req.appAudience;
      res.json({ ok: true });
    });

    await request(app)
      .get('/capture')
      .set('Authorization', `Bearer ${clientToken}`)
      .set('X-App-Audience', 'client')
      .expect(200);

    expect(capturedAudience).toBe('client');
  });

  test('valores válidos de audiencia', () => {
    expect(VALID_AUDIENCES).toEqual(['client', 'provider', 'salon', 'admin']);
  });

  test('case insensitive', async () => {
    await request(app)
      .get('/client-only')
      .set('Authorization', `Bearer ${clientToken}`)
      .set('X-App-Audience', 'CLIENT')
      .expect(200);
  });

  test('trim whitespace', async () => {
    await request(app)
      .get('/client-only')
      .set('Authorization', `Bearer ${clientToken}`)
      .set('X-App-Audience', '  client  ')
      .expect(200);
  });
});

describe('requireRoleAndAudience middleware combinado', () => {
  let app;

  beforeEach(() => {
    app = createApp();

    const clientToken = createToken({
      id: 1,
      email: 'client@test.com',
      role: 'client',
      roles: ['client']
    });

    const providerToken = createToken({
      id: 2,
      email: 'provider@test.com',
      role: 'provider',
      roles: ['provider', 'owner']
    });

    app.get('/provider-endpoint', requireRoleAndAudience('provider', 'admin', { audience: 'provider' }), (req, res) => res.json({ ok: true }));
    app.get('/client-or-admin', requireRoleAndAudience('client', 'admin', { audience: 'client' }), (req, res) => res.json({ ok: true }));
  });

  const clientToken = createToken({
    id: 1,
    email: 'client@test.com',
    role: 'client',
    roles: ['client']
  });

  const providerToken = createToken({
    id: 2,
    email: 'provider@test.com',
    role: 'provider',
    roles: ['provider', 'owner']
  });

  test('provider con audience correcto accede', async () => {
    await request(app)
      .get('/provider-endpoint')
      .set('Authorization', `Bearer ${providerToken}`)
      .set('X-App-Audience', 'provider')
      .expect(200);
  });

  test('client NO accede a endpoint provider', async () => {
    await request(app)
      .get('/provider-endpoint')
      .set('Authorization', `Bearer ${clientToken}`)
      .set('X-App-Audience', 'client')
      .expect(403);
  });

  test('provider sin audience header falla', async () => {
    await request(app)
      .get('/provider-endpoint')
      .set('Authorization', `Bearer ${providerToken}`)
      .expect(400);
  });

  test('client con audience correcto accede a client-or-admin', async () => {
    await request(app)
      .get('/client-or-admin')
      .set('Authorization', `Bearer ${clientToken}`)
      .set('X-App-Audience', 'client')
      .expect(200);
  });

  test('admin accede a client-or-admin', async () => {
    const adminToken = createToken({
      id: 3,
      email: 'admin@test.com',
      role: 'admin',
      roles: ['admin']
    });

    await request(app)
      .get('/client-or-admin')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-App-Audience', 'client')
      .expect(200);
  });
});

describe('validateAppAudience - validación de parámetros', () => {
  test('lanza error sin audiencias permitidas', () => {
    expect(() => validateAppAudience({ allowed: 'invalid' })).toThrow('se requiere al menos una audiencia válida');
  });
});
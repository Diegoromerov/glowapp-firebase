/**
 * Contrato: Audience Binding (Fase 4)
 * 
 * Valida que el aislamiento por app (client vs provider) esté garantizado
 * en toda la API mediante:
 * 1. JWT `audience` claim == header `X-App-Audience` → 200
 * 2. JWT `audience` claim != header `X-App-Audience` → 403
 * 3. Falta header `X-App-Audience` → 400 (cuando requireAudience=true)
 * 4. Header `X-App-Audience` inválido → 403
 * 5. JWT sin `audience` claim → se permite (compatibilidad) pero se loggea warning
 * 
 * PATRÓN: Montar middlewares + rutas de prueba en app Express limpia
 * (no usar index.js completo que inicializa BD/Redis)
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-min-32-chars-long-enough-for-testing-only';

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { validateAppAudience } = require('../../../src/middleware/appAudience');
const { requireAnyRole, providerOnly, clientOnly } = require('../../../src/middleware/requireAnyRole');

const JWT_SECRET = 'test-secret-min-32-chars-long-enough-for-testing-only';

function makeToken(payload = {}) {
  const base = {
    id: 1,
    email: 'test@glowapp.com',
    role: 'provider',
    roles: ['provider'],
    ...payload
  };
  return jwt.sign(base, JWT_SECRET, { expiresIn: '1h' });
}

function makeClientToken(payload = {}) {
  return makeToken({ ...payload, role: 'client', roles: ['client'], audience: 'client' });
}

function makeProviderToken(payload = {}) {
  return makeToken({ ...payload, role: 'provider', roles: ['provider'], audience: 'provider' });
}

// Mock authMiddleware simple para tests
function mockAuthMiddleware(req, res, next) {
  const auth = req.header('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Token requerido' });
  }
  const token = auth.replace('Bearer ', '');
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Token inválido' });
  }
}

function buildTestApp() {
  const app = express();
  app.use(express.json());
  
  // Middleware global de audience (igual que en index.js)
  app.use('/api', validateAppAudience({ required: true }));
  
  // Rutas de prueba con diferentes configuraciones de audience
  app.get('/api/test/provider-only', mockAuthMiddleware, providerOnly, (req, res) => {
    res.json({ success: true, endpoint: 'provider-only', audience: req.appAudience });
  });
  
  app.get('/api/test/client-only', mockAuthMiddleware, clientOnly, (req, res) => {
    res.json({ success: true, endpoint: 'client-only', audience: req.appAudience });
  });
  
  // Endpoint con requireAnyRole explícito + audience
  app.get('/api/test/require-provider', mockAuthMiddleware, requireAnyRole('provider', 'admin', { audience: 'provider', requireAudience: true }), (req, res) => {
    res.json({ success: true, endpoint: 'require-provider', audience: req.appAudience });
  });
  
  app.get('/api/test/require-client', mockAuthMiddleware, requireAnyRole('client', 'admin', { audience: 'client', requireAudience: true }), (req, res) => {
    res.json({ success: true, endpoint: 'require-client', audience: req.appAudience });
  });
  
  // Endpoint que acepta ambas audiences
  app.get('/api/test/any-app', mockAuthMiddleware, requireAnyRole('client', 'provider', 'admin'), (req, res) => {
    res.json({ success: true, endpoint: 'any-app', audience: req.appAudience });
  });
  
  return app;
}

describe('CONTRACT: Audience Binding (X-App-Audience + JWT audience claim)', () => {
  let app;
  
  beforeAll(() => {
    app = buildTestApp();
  });

  describe('✅ CASOS DE ÉXITO: audience match', () => {
    
    test('provider token + provider header → 200', async () => {
      const token = makeProviderToken({ audience: 'provider' });
      
      const res = await request(app)
        .get('/api/test/provider-only')
        .set('Authorization', `Bearer ${token}`)
        .set('X-App-Audience', 'provider');
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.audience).toBe('provider');
    });

    test('client token + client header → 200', async () => {
      const token = makeClientToken({ audience: 'client' });
      
      const res = await request(app)
        .get('/api/test/client-only')
        .set('Authorization', `Bearer ${token}`)
        .set('X-App-Audience', 'client');
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.audience).toBe('client');
    });

    test('admin token con provider header → 200 (admin bypass)', async () => {
      // Admin bypass funciona PERO el JWT audience debe coincidir con header
      // Creamos token admin con audience 'provider' para que coincida
      const token = jwt.sign(
        { id: 999, email: 'admin@glowapp.com', role: 'admin', roles: ['admin'], audience: 'provider' },
        JWT_SECRET,
        { expiresIn: '1h' }
      );
      
      const res = await request(app)
        .get('/api/test/provider-only')
        .set('Authorization', `Bearer ${token}`)
        .set('X-App-Audience', 'provider');
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('provider token + provider header en requireAnyRole explícito → 200', async () => {
      const token = makeProviderToken({ audience: 'provider' });
      
      const res = await request(app)
        .get('/api/test/require-provider')
        .set('Authorization', `Bearer ${token}`)
        .set('X-App-Audience', 'provider');
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('ambas audiences válidas en endpoint any-app → 200', async () => {
      const providerToken = makeProviderToken({ audience: 'provider' });
      const clientToken = makeClientToken({ audience: 'client' });
      
      const resProvider = await request(app)
        .get('/api/test/any-app')
        .set('Authorization', `Bearer ${providerToken}`)
        .set('X-App-Audience', 'provider');
      
      expect(resProvider.status).toBe(200);
      
      const resClient = await request(app)
        .get('/api/test/any-app')
        .set('Authorization', `Bearer ${clientToken}`)
        .set('X-App-Audience', 'client');
      
      expect(resClient.status).toBe(200);
    });
  });

  describe('🚫 CASOS DE FALLO: audience mismatch (validado por validateAppAudience global)', () => {
    
    test('provider token + client header → 403 (header no permitido para endpoint provider)', async () => {
      const token = makeProviderToken({ audience: 'provider' });
      
      const res = await request(app)
        .get('/api/test/provider-only')
        .set('Authorization', `Bearer ${token}`)
        .set('X-App-Audience', 'client');
      
      // El middleware global validateAppAudience rechaza audience 'client' en endpoint provider-only
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
      expect(res.body.message).toContain('Audiencia');
      expect(res.body.message).toContain('client');
    });

    test('client token + provider header → 403 (header no permitido para endpoint client)', async () => {
      const token = makeClientToken({ audience: 'client' });
      
      const res = await request(app)
        .get('/api/test/client-only')
        .set('Authorization', `Bearer ${token}`)
        .set('X-App-Audience', 'provider');
      
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
      expect(res.body.message).toContain('Audiencia');
      expect(res.body.message).toContain('provider');
    });

    test('provider token + salon header → 403 (header no permitido)', async () => {
      const token = makeProviderToken({ audience: 'provider' });
      
      const res = await request(app)
        .get('/api/test/require-provider')
        .set('Authorization', `Bearer ${token}`)
        .set('X-App-Audience', 'salon');
      
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
      expect(res.body.message).toContain('Audiencia');
      expect(res.body.message).toContain('salon');
    });

    test('client token + admin header → 403 (header no permitido)', async () => {
      const token = makeClientToken({ audience: 'client' });
      
      const res = await request(app)
        .get('/api/test/require-client')
        .set('Authorization', `Bearer ${token}`)
        .set('X-App-Audience', 'admin');
      
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
      expect(res.body.message).toContain('Audiencia');
      expect(res.body.message).toContain('admin');
    });
  });

  describe('🔍 CASOS EDGE: header inválido o faltante', () => {
    
    test('sin header X-App-Audience → 400 (global require: true)', async () => {
      const token = makeProviderToken({ audience: 'provider' });
      
      const res = await request(app)
        .get('/api/test/provider-only')
        .set('Authorization', `Bearer ${token}`);
      
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BAD_REQUEST');
      expect(res.body.message).toContain('X-App-Audience requerido');
    });

    test('header X-App-Audience inválido (ej: "invalid") → 400 (global valida formato)', async () => {
      const token = makeProviderToken({ audience: 'provider' });
      
      const res = await request(app)
        .get('/api/test/provider-only')
        .set('Authorization', `Bearer ${token}`)
        .set('X-App-Audience', 'invalid');
      
      // validateAppAudience normaliza y valida contra lista blanca → 400 BAD_REQUEST
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BAD_REQUEST');
      expect(res.body.message).toContain('X-App-Audience requerido');
    });

    test('JWT sin audience claim → permitido (compatibilidad)', async () => {
      const token = jwt.sign(
        { id: 2, email: 'legacy@glowapp.com', role: 'provider', roles: ['provider'] },
        JWT_SECRET,
        { expiresIn: '1h' }
      );
      
      const res = await request(app)
        .get('/api/test/provider-only')
        .set('Authorization', `Bearer ${token}`)
        .set('X-App-Audience', 'provider');
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('🔐 Integración: audience mismatch bloquea ANTES que roles (solo cuando requireAnyRole tiene audience)', () => {
    
    test('client token (audience:client) con rol provider + provider header → 403 (requireAnyRole con audience valida JWT claim)', async () => {
      const token = jwt.sign(
        { id: 3, email: 'weird@glowapp.com', role: 'provider', roles: ['provider'], audience: 'client' },
        JWT_SECRET,
        { expiresIn: '1h' }
      );
      
      const res = await request(app)
        .get('/api/test/require-provider')
        .set('Authorization', `Bearer ${token}`)
        .set('X-App-Audience', 'provider');
      
      // requireAnyRole con { audience: 'provider' } valida JWT claim vs header
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
      expect(res.body.message).toContain('JWT audience claim');
    });

    test('provider token + client header en endpoint any-app → 200 (sin audience en requireAnyRole, no valida JWT claim)', async () => {
      const token = makeProviderToken({ audience: 'provider' });
      
      const res = await request(app)
        .get('/api/test/any-app')
        .set('Authorization', `Bearer ${token}`)
        .set('X-App-Audience', 'client');
      
      // any-app usa requireAnyRole SIN audience option → no valida JWT claim
      // El header 'client' es válido globalmente, así que pasa
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('🎯 CASOS ESPECÍFICOS DE REGRESIÓN', () => {
    
    test('token con audience "salon" + header "provider" → 403 (salon usa app provider)', async () => {
      const token = jwt.sign(
        { id: 4, email: 'salon@glowapp.com', role: 'salon', roles: ['salon'], audience: 'salon' },
        JWT_SECRET,
        { expiresIn: '1h' }
      );
      
      const res = await request(app)
        .get('/api/test/require-provider')
        .set('Authorization', `Bearer ${token}`)
        .set('X-App-Audience', 'provider');
      
      // salon audience != provider header → mismatch
      expect(res.status).toBe(403);
      expect(res.body.message).toContain('JWT audience claim');
    });

    test('case insensitive: "PROVIDER" header + "provider" JWT → 200', async () => {
      const token = makeProviderToken({ audience: 'provider' });
      
      const res = await request(app)
        .get('/api/test/provider-only')
        .set('Authorization', `Bearer ${token}`)
        .set('X-App-Audience', 'PROVIDER');
      
      expect(res.status).toBe(200);
    });

    test('case insensitive: "CLIENT" header + "client" JWT → 200', async () => {
      const token = makeClientToken({ audience: 'client' });
      
      const res = await request(app)
        .get('/api/test/client-only')
        .set('Authorization', `Bearer ${token}`)
        .set('X-App-Audience', 'CLIENT');
      
      expect(res.status).toBe(200);
    });
  });
});
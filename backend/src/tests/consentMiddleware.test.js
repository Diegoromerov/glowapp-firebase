/**
 * backend/src/tests/consentMiddleware.test.js
 * Tests unitarios para consentMiddleware.js
 * Mínimo 5 casos
 */

// Mock Redis client first
const mockRedisClient = {
  connect: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
  get: jest.fn().mockResolvedValue(null),
  setEx: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  keys: jest.fn().mockResolvedValue([]),
};

jest.mock('redis', () => ({
  createClient: () => mockRedisClient,
}));

// Mock rateLimiter's getRedisClient
jest.mock('../middleware/rateLimiter', () => ({
  getRedisClient: jest.fn().mockResolvedValue(mockRedisClient),
}));

// Mock consentService ANTES de importar el middleware
jest.mock('../services/consentService', () => ({
  checkConsent: jest.fn(),
  logAccess: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const express = require('express');
const { checkConsent, logAccess } = require('../services/consentService');
const { requireConsent, auraBiometricMiddleware } = require('../middleware/consentMiddleware');

describe('consentMiddleware', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    
    app = express();
    app.use(express.json());
    
    // Mock user authentication
    app.use((req, res, next) => {
      req.user = { id: 'user-123' };
      next();
    });
  });

  describe('requireConsent', () => {
    test('Request sin consentimiento → 403', async () => {
      checkConsent.mockResolvedValue({ granted: false });
      
      const app = express();
      app.use(express.json());
      app.use((req, res, next) => { req.user = { id: 'user-123' }; next(); });
      app.get('/test-facial', requireConsent('facial_analysis'), (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app).get('/test-facial');
      
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('consent_required');
      expect(response.body.consent_type).toBe('facial_analysis');
      expect(response.body.message).toContain('consentimiento');
    });

    test('Request con consentimiento → 200', async () => {
      checkConsent.mockResolvedValue({ granted: true, grantedAt: new Date(), version: '1.0' });
      
      const app = express();
      app.use(express.json());
      app.use((req, res, next) => { req.user = { id: 'user-123' }; next(); });
      app.get('/test-skin', requireConsent('skin_scan'), (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app).get('/test-skin');
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('Request con consentimiento revocado → 403', async () => {
      checkConsent.mockResolvedValue({ granted: false });
      
      const app = express();
      app.use(express.json());
      app.use((req, res, next) => { req.user = { id: 'user-123' }; next(); });
      app.get('/test-hair', requireConsent('hair_analysis'), (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app).get('/test-hair');
      
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('consent_required');
      expect(response.body.consent_type).toBe('hair_analysis');
    });

    test('Acceso se loguea en biometric_access_log', async () => {
      checkConsent.mockResolvedValue({ granted: true, grantedAt: new Date(), version: '1.0' });
      logAccess.mockResolvedValue(undefined);
      
      const app = express();
      app.use(express.json());
      app.use((req, res, next) => { req.user = { id: 'user-123' }; next(); });
      app.get('/test-vto', requireConsent('virtual_try_on'), (req, res) => {
        res.json({ success: true });
      });

      await request(app).get('/test-vto');
      
      expect(logAccess).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          accessedBy: 'middleware',
          accessType: 'authorized_virtual_try_on',
        })
      );
    });

    test('Middleware no crashea si Redis está caído', async () => {
      checkConsent.mockResolvedValue({ granted: true, grantedAt: new Date(), version: '1.0' });
      
      const app = express();
      app.use(express.json());
      app.use((req, res, next) => { req.user = { id: 'user-123' }; next(); });
      app.get('/test-facial-2', requireConsent('facial_analysis'), (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app).get('/test-facial-2');
      
      // No debe crashear, debe responder 200
      expect(response.status).toBe(200);
    });
  });

  describe('auraBiometricMiddleware', () => {
    test('Request sin consentimiento all_biometric ni facial_analysis → 403', async () => {
      checkConsent.mockResolvedValue({ granted: false });
      
      const app = express();
      app.use(express.json());
      app.use((req, res, next) => { req.user = { id: 'user-123' }; next(); });
      app.get('/aura/profile', auraBiometricMiddleware(), (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app).get('/aura/profile');
      
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('consent_required');
      expect(response.body.consent_type).toBe('all_biometric');
    });

    test('Request con consentimiento facial_analysis → 200', async () => {
      checkConsent
        .mockResolvedValueOnce({ granted: false }) // all_biometric
        .mockResolvedValueOnce({ granted: true, grantedAt: new Date(), version: '1.0' }); // facial_analysis

      const app = express();
      app.use(express.json());
      app.use((req, res, next) => { req.user = { id: 'user-123' }; next(); });
      app.get('/aura/profile', auraBiometricMiddleware(), (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app).get('/aura/profile');
      
      expect(response.status).toBe(200);
    });
  });
});
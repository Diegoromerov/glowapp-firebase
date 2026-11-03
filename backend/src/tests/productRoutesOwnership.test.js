// backend/src/tests/productRoutesOwnership.test.js
/**
 * Ownership tests for productRoutes biometric endpoints.
 */

// Set environment variable for biometric encryption key (required by biometricCryptoService)
process.env.BIOMETRIC_ENCRYPTION_KEY = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

// Mock dependencies before requiring the module under test
jest.mock('../services/biometricCryptoService', () => ({
  encrypt: jest.fn().mockImplementation((data) => {
    // Simple mock: just return the data as a string (not actual encryption)
    return JSON.stringify(data);
  }),
  decrypt: jest.fn().mockImplementation((encrypted) => {
    // Simple mock: parse the JSON string back to object
    return JSON.parse(encrypted);
  }),
}));

jest.mock('../services/openBeautyFacts', () => ({
  searchByBarcode: jest.fn(),
  getRecommendedProducts: jest.fn(),
}));

jest.mock('../services/biometric/profile.service', () => ({
  getProfile: jest.fn(),
}));

// Mock authMiddleware to attach user from headers
jest.mock('../middleware/auth', () => ({
  authMiddleware: (req, res, next) => {
    const userId = req.headers['x-test-user-id'];
    const role = req.headers['x-test-user-role'];
    if (userId) {
      req.user = { id: parseInt(userId, 10), role: role || undefined };
    }
    next();
  }
}));

const request = require('supertest');
const express = require('express');
const productRoutes = require('../routes/productRoutes');

const openBeautyFacts = require('../services/openBeautyFacts');
const profileService = require('../services/biometric/profile.service');

const app = express();
app.use(express.json());
app.use('/api', productRoutes);

describe('Product Routes Ownership Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/biometric/check', () => {
    const mockBarcode = '1234567890123';
    const mockProduct = {
      ingredients: 'Ácido hialurónico, Vitamina E',
    };

    test('should allow owner to check product compatibility', async () => {
      const ownerId = 1;
      const mockProfile = {
        faceScores: { hydration: 40, spots: 30, wrinkles: 20 },
        keyIngredients: []
      };
      openBeautyFacts.searchByBarcode.mockResolvedValue(mockProduct);
      profileService.getProfile.mockResolvedValue(mockProfile);

      const response = await request(app)
        .post('/api/biometric/check')
        .set('x-test-user-id', ownerId.toString())
        .send({ userId: ownerId.toString(), barcode: mockBarcode });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.product.compatible).toBe(true);
      expect(profileService.getProfile).toHaveBeenCalledWith(ownerId); // Expect number, not string
    });

    test('should deny non-owner from checking product compatibility', async () => {
      const ownerId = 1;
      const attackerId = 2;
      const mockProfile = {
        faceScores: { hydration: 40, spots: 30, wrinkles: 20 },
        keyIngredients: []
      };
      openBeautyFacts.searchByBarcode.mockResolvedValue(mockProduct);
      profileService.getProfile.mockResolvedValue(mockProfile);

      const response = await request(app)
        .post('/api/biometric/check')
        .set('x-test-user-id', attackerId.toString())
        .send({ userId: ownerId.toString(), barcode: mockBarcode });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('FORBIDDEN');
      expect(response.body.message).toBe('No tienes permisos para acceder a este perfil.');
      expect(profileService.getProfile).not.toHaveBeenCalled();
    });

    test('should allow admin to check any user product compatibility', async () => {
      const targetUserId = 1;
      const adminId = 999;
      const mockProfile = {
        faceScores: { hydration: 40, spots: 30, wrinkles: 20 },
        keyIngredients: []
      };
      openBeautyFacts.searchByBarcode.mockResolvedValue(mockProduct);
      profileService.getProfile.mockResolvedValue(mockProfile);

      const response = await request(app)
        .post('/api/biometric/check')
        .set('x-test-user-id', adminId.toString())
        .set('x-test-user-role', 'admin')
        .send({ userId: targetUserId.toString(), barcode: mockBarcode });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(profileService.getProfile).toHaveBeenCalledWith(targetUserId); // Expect number, not string
    });

    test('should return 400 if userId or barcode missing', async () => {
      const userId = 1;
      const response = await request(app)
        .post('/api/biometric/check')
        .set('x-test-user-id', userId.toString())
        .send({ userId: userId.toString(), barcode: '' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('userId y barcode son obligatorios');
    });
  });

  describe('GET /api/biometric/recommended/:userId', () => {
    test('should allow owner to get recommendations', async () => {
      const ownerId = 1;
      const mockProfile = {
        keyIngredients: ['ácido hialurónico', 'vitamina c']
      };
      const mockProducts = [{ id: 1, name: 'Product A' }, { id: 2, name: 'Product B' }];
      profileService.getProfile.mockResolvedValue(mockProfile);
      openBeautyFacts.getRecommendedProducts.mockResolvedValue(mockProducts);

      const response = await request(app)
        .get(`/api/biometric/recommended/${ownerId}`)
        .set('x-test-user-id', ownerId.toString());

      expect(response.status).toBe(200);
      expect(response.body.products).toEqual(mockProducts);
      expect(profileService.getProfile).toHaveBeenCalledWith(ownerId); // Expect number, not string
    });

    test('should deny non-owner from getting recommendations', async () => {
      const ownerId = 1;
      const attackerId = 2;
      const mockProfile = {
        keyIngredients: ['ácido hialurónico']
      };
      profileService.getProfile.mockResolvedValue(mockProfile);

      const response = await request(app)
        .get(`/api/biometric/recommended/${ownerId}`)
        .set('x-test-user-id', attackerId.toString());

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('FORBIDDEN');
      expect(response.body.message).toBe('No tienes permisos para acceder a este perfil.');
      expect(profileService.getProfile).not.toHaveBeenCalled();
    });

    test('should allow admin to get recommendations for any user', async () => {
      const targetUserId = 1;
      const adminId = 999;
      const mockProfile = {
        keyIngredients: ['ácido hialurónico']
      };
      const mockProducts = [{ id: 1, name: 'Product A' }];
      profileService.getProfile.mockResolvedValue(mockProfile);
      openBeautyFacts.getRecommendedProducts.mockResolvedValue(mockProducts);

      const response = await request(app)
        .get(`/api/biometric/recommended/${targetUserId}`)
        .set('x-test-user-id', adminId.toString())
        .set('x-test-user-role', 'admin');

      expect(response.status).toBe(200);
      expect(response.body.products).toEqual(mockProducts);
      expect(profileService.getProfile).toHaveBeenCalledWith(targetUserId); // Expect number, not string
    });

    test('should return 404 if profile not found', async () => {
      const userId = 1;
      profileService.getProfile.mockResolvedValue(null);

      const response = await request(app)
        .get(`/api/biometric/recommended/${userId}`)
        .set('x-test-user-id', userId.toString());

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Perfil biométrico no encontrado');
    });
  });
});
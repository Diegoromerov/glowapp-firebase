// backend/src/tests/sprint2_agents.test.js
const { pool } = require('../config/db');
const atenaAgent = require('../services/agents/atenaAgent');
const hermesAgent = require('../services/agents/hermesAgent');
const { executeAuraTool } = require('../services/auraToolExecutor');
const { checkConsent, logAccess } = require('../services/consentService');

jest.mock('../config/db', () => ({
  pool: {
    query: jest.fn()
  }
}));

jest.mock('../config/redis', () => ({
  isOpen: false,
  get: jest.fn(),
  set: jest.fn()
}));

jest.mock('../services/consentService', () => ({
  checkConsent: jest.fn(),
  logAccess: jest.fn().mockResolvedValue(undefined),
}));

describe('Pruebas unitarias de Sprint 2 (Agente ATENA y Agente HERMES)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Agente ATENA (Biometría y Colorimetría)', () => {
    test('Debería retornar enriquecimiento biométrico y paleta de colorimetría para subtono frío', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'prof-777',
            user_id: 1,
            face_scores: { hydration: 45, wrinkles: 35, pores: 50, subtono: 'frío' },
            hands_diagnosis: { sequedad: 'alta' },
            recommendation: 'Usar crema enriquecida con ácido hialurónico',
            created_at: new Date()
          }
        ]
      });

      const diagnosis = await atenaAgent.getBiometricDiagnosis(1);

      expect(diagnosis.status).toBe('success');
      expect(diagnosis.skinSubtone).toBe('frío');
      expect(diagnosis.recommendedColorPalette).toContain('Plateado');
      expect(diagnosis.recommendedColorPalette).toContain('Rojo Rubí');
      expect(diagnosis.recommendedIngredients).toContain('Ácido Hialurónico');
      expect(diagnosis.recommendedIngredients).toContain('Niacinamida 10%');
    });

    test('Debería manejar usuarios sin perfil previo amablemente', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const diagnosis = await atenaAgent.getBiometricDiagnosis(999);
      expect(diagnosis.status).toBe('no_profile_found');
    });
  });

  describe('Agente HERMES (Geometría PostGIS y Logística)', () => {

    test('Debería buscar prestadores cercanos usando PostGIS en Bogotá', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            service_id: 'serv-101',
            name: 'Corte y Lavado',
            price: 35000,
            duration_minutes: 45,
            business_name: 'Salón Ana Beauty',
            rating_avg: 4.9,
            distance_km: 0.8
          }
        ]
      });

      const result = await hermesAgent.findNearbyServices({
        latitude: 4.6097,
        longitude: -74.0817,
        category: 'Cabello',
        maxDistanceKm: 3
      });

      expect(pool.query).toHaveBeenCalled();
      expect(result.status).toBe('success');
      expect(result.services.length).toBe(1);
      expect(result.services[0].business_name).toBe('Salón Ana Beauty');
      expect(result.services[0].distance_km).toBe(0.8);
    });

    test('Debería verificar la disponibilidad de agenda para una fecha', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          { id: 'book-1', scheduled_at: '14:00', estado: 'confirmed' }
        ]
      });

      const result = await hermesAgent.checkAvailability({
        providerId: 5,
        serviceId: 'serv-101',
        date: '2026-08-01'
      });

      expect(result.status).toBe('success');
      expect(result.totalOccupied).toBe(1);
      expect(result.occupiedSlots[0].startTime).toBe('14:00');
    });
  });

  describe('Integración con auraToolExecutor', () => {

    test('executeAuraTool debería delegar query_user_biometric_profile a ATENA', async () => {
      // Mock consent check
      checkConsent.mockResolvedValue({ granted: true, grantedAt: new Date(), version: '1.0' });
      logAccess.mockResolvedValue(undefined);
      
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'prof-888',
            user_id: 2,
            face_scores: { hydration: 80, subtono: 'cálido' },
            hands_diagnosis: {},
            recommendation: 'Usar protector solar',
            created_at: new Date()
          }
        ]
      });

      const result = await executeAuraTool('query_user_biometric_profile', { userId: 2 }, 2);
      expect(result.status).toBe('success');
      expect(result.recommendedColorPalette).toContain('Dorado');
    });

    test('executeAuraTool debería delegar search_nearby_services a HERMES', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            service_id: 'serv-202',
            name: 'Visajismo de Cejas',
            price: 25000,
            business_name: 'Brow Studio',
            distance_km: 1.5
          }
        ]
      });

      const result = await executeAuraTool('search_nearby_services', { latitude: 4.6097, longitude: -74.0817 }, 2);
      expect(result.status).toBe('success');
      expect(result.services[0].name).toBe('Visajismo de Cejas');
    });
  });

});
// backend/src/tests/automation_patterns.test.js
const { pool } = require('../config/db');
const agentActionPayloads = require('../services/agentActionPayloads');
const backgroundWorkerService = require('../services/backgroundWorkerService');
const b2bCoPilotService = require('../services/b2bCoPilotService');

jest.mock('../config/db', () => ({
  pool: {
    query: jest.fn()
  }
}));

jest.mock('../services/websocketService', () => ({
  notifyUserChatMessage: jest.fn(),
  notifyUserAuraStatus: jest.fn()
}));

describe('Pruebas unitarias de los 4 Patrones Avanzados de Automatización con IA', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Patrón 1: Payloads de Acción Directa para UI (agentActionPayloads.js)', () => {
    test('Debería generar un payload de acción NAVIGATE_AND_FILL con estructura correcta', () => {
      const payload = agentActionPayloads.createNavigateAndFillAction({
        providerId: 5,
        serviceId: 'serv-101',
        serviceName: 'Manicura Semipermanente',
        price: 45000,
        date: '2026-08-01',
        time: '15:00'
      });

      expect(payload.type).toBe('ACTION_PAYLOAD');
      expect(payload.action).toBe('NAVIGATE_AND_FILL');
      expect(payload.targetScreen).toBe('/booking_checkout');
      expect(payload.payload.providerId).toBe(5);
      expect(payload.payload.price).toBe(45000);
    });

    test('Debería generar un payload de acción OPEN_MODULO_IDEAS', () => {
      const payload = agentActionPayloads.createIdeasRedirectionAction('eyebrow-visagism');

      expect(payload.action).toBe('OPEN_MODULO_IDEAS');
      expect(payload.targetScreen).toBe('/modulo_ideas');
      expect(payload.payload.moduleKey).toBe('eyebrow-visagism');
    });
  });

  describe('Patrón 2: Trabajador en Segundo Plano (backgroundWorkerService.js)', () => {
    test('Debería procesar la recuperación de slots cancelados y notificar usuarios en la zona', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          { user_id: 10, nombre: 'Laura' },
          { user_id: 11, nombre: 'Sofia' }
        ]
      });

      const result = await backgroundWorkerService.handleBookingCancellation({
        bookingId: 'book-77',
        providerId: 5,
        serviceName: 'Manicura',
        date: '2026-08-01',
        time: '14:00'
      });

      expect(result.status).toBe('success');
      expect(result.notifiedUsersCount).toBe(2);
      expect(result.notifiedUsers).toContain(10);
    });
  });

  describe('Patrón 4: Co-Piloto de Operaciones B2B (b2bCoPilotService.js)', () => {
    test('Debería generar una respuesta positiva para reseñas de 5 estrellas', async () => {
      const result = await b2bCoPilotService.generateReviewAutoReply({
        rating: 5,
        reviewText: 'Excelente servicio y atención rápida',
        clientName: 'Camila'
      });

      expect(result.status).toBe('success');
      expect(result.suggestedReply).toContain('Camila');
      expect(result.suggestedReply).toContain('5 estrellas');
    });

    test('Debería generar una respuesta empática para reseñas de 2 estrellas', async () => {
      const result = await b2bCoPilotService.generateReviewAutoReply({
        rating: 2,
        reviewText: 'Llegaron un poco tarde',
        clientName: 'Carlos'
      });

      expect(result.status).toBe('success');
      expect(result.suggestedReply).toContain('Lamentamos mucho');
    });
  });
});

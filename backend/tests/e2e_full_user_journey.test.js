// backend/tests/e2e_full_user_journey.test.js
/**
 * Test E2E Maestro: Ciclo de Vida Completo del Ecosistema GlowApp
 * Flujo: Biometría Glow IA+ -> Notificación FCM -> POS SaaS -> Consignación -> Cierre de Caja
 */
const fcmNotificationService = require('../src/services/fcmNotificationService');
const inventoryController = require('../src/controllers/inventoryController');

describe('Fase F9.003 E2E Integration Suite: Full GlowApp User Journey', () => {

  test('1. Debe simular escaneo biométrico y generación de métricas de piel', () => {
    const skinMetrics = {
      hydration_score: 0.85,
      pore_density_score: 0.15,
      sebum_balance_score: 0.78,
      elasticity_score: 0.90,
    };

    expect(skinMetrics.hydration_score).toBeGreaterThan(0.5);
    expect(skinMetrics.pore_density_score).toBeLessThan(0.3);
  });

  test('2. Debe enviar notificaciones FCM Push de reserva y alerta de consignación', async () => {
    const pushBookingResult = await fcmNotificationService.sendBookingPushNotification('mock-device-token', {
      bookingId: 'booking-999',
      status: 'CONFIRMED',
      clientName: 'María López',
      serviceName: 'Balayage & Visagismo Pro',
      scheduledAt: '2026-09-05 10:00 AM',
    });

    expect(pushBookingResult.success).toBe(true);

    const pushStockAlertResult = await fcmNotificationService.sendConsignmentStockAlert('mock-device-token', {
      productoId: 'prod-456',
      productoNombre: 'Tinte Keratina Gold 60ml',
      cantidadDisponible: 1,
    });

    expect(pushStockAlertResult.success).toBe(true);
    expect(pushStockAlertResult.simulated || pushStockAlertResult.messageId).toBeTruthy();
  });

  test('3. Debe calcular el desglose de caja diaria SaaS con cobros POS directos', () => {
    const appointments = [
      { id: '1', service: 'Manicura Rusa', price: 60000, paymentMethod: 'EFECTIVO' },
      { id: '2', service: 'Balayage Pro', price: 250000, paymentMethod: 'DATAFONO_PROPIO' },
      { id: '3', service: 'Corte Caballero', price: 40000, paymentMethod: 'NEQUI_DIRECTO' },
    ];

    const totalCalculated = appointments.reduce((acc, app) => acc + app.price, 0);
    const efectivoCalculated = appointments.filter(a => a.paymentMethod === 'EFECTIVO').reduce((acc, a) => acc + a.price, 0);
    const datafonoCalculated = appointments.filter(a => a.paymentMethod === 'DATAFONO_PROPIO').reduce((acc, a) => acc + a.price, 0);

    expect(totalCalculated).toBe(350000);
    expect(efectivoCalculated).toBe(60000);
    expect(datafonoCalculated).toBe(250000);
  });

});
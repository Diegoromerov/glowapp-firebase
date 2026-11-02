const emailService = require('../src/services/email.service');

describe('Phase 2 Infrastructure & Email Integration Tests', () => {
  test('emailService.sendOtpEmail - debe simular el envío de OTP correctamente', async () => {
    const result = await emailService.sendOtpEmail({
      to: 'cliente@glowapp.com',
      otp: '654321',
      userName: 'Cliente Pruebas',
    });

    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.provider).toBe('simulation');
  });

  test('emailService.sendBookingConfirmationEmail - debe simular correo de confirmación de reserva', async () => {
    const result = await emailService.sendBookingConfirmationEmail({
      to: 'cliente@glowapp.com',
      userName: 'Cliente Pruebas',
      providerName: 'Estudio de Belleza Glow',
      serviceName: 'Manicura Semipermanente',
      scheduledAt: '2026-08-01 10:00 AM',
      totalAmount: 45000,
    });

    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.provider).toBe('simulation');
  });
});

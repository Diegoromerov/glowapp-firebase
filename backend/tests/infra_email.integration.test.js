const emailService = require('../src/services/email.service');
const axios = require('axios');

describe('Phase 2 Infrastructure & Email Integration Tests', () => {
  test('emailService.sendOtpEmail - debe simular el envío de OTP en desarrollo', async () => {
    const previousEnv = process.env.NODE_ENV;
    const previousRailway = {
      RAILWAY_ENVIRONMENT: process.env.RAILWAY_ENVIRONMENT,
      RAILWAY_SERVICE_NAME: process.env.RAILWAY_SERVICE_NAME,
      RAILWAY_PROJECT_ID: process.env.RAILWAY_PROJECT_ID,
    };
    process.env.NODE_ENV = 'development';
    delete process.env.RAILWAY_ENVIRONMENT;
    delete process.env.RAILWAY_SERVICE_NAME;
    delete process.env.RAILWAY_PROJECT_ID;
    try {
      const result = await emailService.sendOtpEmail({
        to: 'cliente@glowapp.com',
        otp: '654321',
        userName: 'Cliente Pruebas',
      });
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.provider).toBe('simulation');
    } finally {
      process.env.NODE_ENV = previousEnv;
      for (const [key, value] of Object.entries(previousRailway)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test('emailService.sendOtpEmail - falla en producción si el proveedor solo simula', async () => {
    const previousEnv = process.env.NODE_ENV;
    const service = Object.create(Object.getPrototypeOf(emailService));
    Object.assign(service, emailService);
    service.resendApiKey = undefined;
    service.sendgridApiKey = undefined;
    process.env.NODE_ENV = 'production';
    try {
      await expect(service.sendOtpEmail({
        to: 'cliente@glowapp.com',
        otp: '654321',
        userName: 'Cliente Pruebas',
      })).rejects.toThrow(/proveedor de correo transaccional configurado/);
    } finally {
      process.env.NODE_ENV = previousEnv;
    }
  });

  test('emailService.sendOtpEmail - entrega por Brevo en staging', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalBrevoKey = process.env.BREVO_API_KEY;
    const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { messageId: 'brevo-message-123' } });
    const service = Object.create(Object.getPrototypeOf(emailService));
    Object.assign(service, emailService, { brevoApiKey: 'brevo-test-key' });
    process.env.NODE_ENV = 'staging';
    delete process.env.RAILWAY_ENVIRONMENT;
    delete process.env.RAILWAY_SERVICE_NAME;
    delete process.env.RAILWAY_PROJECT_ID;
    try {
      const result = await service.sendOtpEmail({ to: 'cliente@glowapp.com', otp: '654321', userName: 'Cliente' });
      expect(result).toEqual({ success: true, provider: 'brevo', id: 'brevo-message-123' });
      expect(post).toHaveBeenCalledWith(
        'https://api.brevo.com/v3/smtp/email',
        expect.objectContaining({ to: [{ email: 'cliente@glowapp.com' }], subject: expect.stringContaining('Recuperación') }),
        expect.objectContaining({ headers: expect.objectContaining({ 'api-key': 'brevo-test-key' }) })
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalBrevoKey === undefined) delete process.env.BREVO_API_KEY;
      else process.env.BREVO_API_KEY = originalBrevoKey;
      post.mockRestore();
    }
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

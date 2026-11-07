const express = require('express');
const request = require('supertest');

jest.mock('../src/config/db', () => ({ pool: { connect: jest.fn(), query: jest.fn() } }));
jest.mock('../src/config/tenantRouting', () => ({
  runAsSystem: jest.fn(async (_deps, fn) => fn({
    query: jest.fn(async (sql) => ({ rows: /SELECT email, nombre/.test(sql)
      ? [{ email: 'cliente-prueba@glow.test', nombre: 'Cliente Prueba' }]
      : [{ fcm_token: 'fcm-test-token' }] })),
  })),
  runAsSystemContext: jest.fn((_fn) => Promise.resolve()),
}));
jest.mock('../src/services/emailService', () => ({
  initEmailService: jest.fn(() => null),
  sendEmail: jest.fn(async () => ({ messageId: 'brevo-test-message', via: 'brevo-api' })),
}));
jest.mock('../src/services/fcmNotificationService', () => ({
  sendOtpReadyNotice: jest.fn(async (_token, payload) => ({ success: true, payload })),
}));
jest.mock('../src/middleware/auth', () => ({ authMiddleware: (req, _res, next) => { req.user = { id: 77 }; next(); } }));
jest.mock('../src/middleware/rateLimiter', () => ({ paymentLimiter: (_req, _res, next) => next(), otpLimiter: (_req, _res, next) => next() }));

const { pool } = require('../src/config/db');
const { runAsSystem } = require('../src/config/tenantRouting');
const emailService = require('../src/services/emailService');
const fcm = require('../src/services/fcmNotificationService');
const paymentRoutes = require('../src/routes/paymentRoutes');

function queryResponse(rows = []) { return { rows }; }

describe('entrega OTP para confirmación de servicio', () => {
  const originalBrevoKey = process.env.BREVO_API_KEY;
  let client;

  beforeEach(() => {
    process.env.BREVO_API_KEY = 'brevo-test-key';
    emailService.initEmailService.mockReturnValue(null);
    emailService.sendEmail.mockResolvedValue({ messageId: 'brevo-test-message', via: 'brevo-api' });
    fcm.sendOtpReadyNotice.mockResolvedValue({ success: true, messageId: 'fcm-test-message' });
    runAsSystem.mockImplementation(async (_deps, fn) => fn({
      query: jest.fn(async (sql) => ({ rows: /fcm_token/.test(sql)
        ? [{ fcm_token: 'fcm-test-token' }]
        : [{ email: 'cliente-prueba@glow.test', nombre: 'Cliente Prueba' }] })),
    }));
    client = {
      query: jest.fn(async (sql) => {
        if (/SELECT rol FROM usuarios/.test(sql)) return queryResponse([{ rol: 'PRESTADOR' }]);
        if (/SELECT b\./.test(sql)) return queryResponse([{ id: '00000000-0000-4000-8000-000000000077', client_id: 11, provider_id: 77, cliente_email: 'cliente-prueba@glow.test', cliente_nombre: 'Cliente Prueba', service_name: 'Servicio de prueba', estado: 'CONFIRMADA' }]);
        if (/SELECT id FROM otp_validaciones/.test(sql)) return queryResponse([]);
        if (/SELECT value FROM platform_config/.test(sql)) return queryResponse([]);
        if (/fcm_token/.test(sql)) return queryResponse([{ fcm_token: 'fcm-test-token' }]);
        return queryResponse([]);
      }),
      release: jest.fn(),
    };
    pool.connect.mockResolvedValue(client);
    pool.query.mockImplementation(async (sql) => /fcm_token/.test(sql)
      ? queryResponse([{ fcm_token: 'fcm-test-token' }])
      : queryResponse([{ rol: 'PRESTADOR' }]));
  });

  afterAll(() => {
    if (originalBrevoKey === undefined) delete process.env.BREVO_API_KEY;
    else process.env.BREVO_API_KEY = originalBrevoKey;
  });

  test('usa Brevo aunque SMTP no esté configurado y mantiene el OTP fuera del push', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/payments', paymentRoutes);

    const res = await request(app).post('/api/payments/bookings/00000000-0000-4000-8000-000000000077/complete');

    expect(res.status).toBe(200);
    expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(emailService.sendEmail.mock.calls[0][0].to).toBe('cliente-prueba@glow.test');
    const html = emailService.sendEmail.mock.calls[0][0].data.html;
    const codigo = html.match(/>(\s*\d{6}\s*)</)?.[1]?.trim();
    expect(codigo).toBeDefined();
    expect(fcm.sendOtpReadyNotice).toHaveBeenCalledWith('fcm-test-token', expect.objectContaining({ bookingId: expect.any(String) }));
    expect(JSON.stringify(fcm.sendOtpReadyNotice.mock.calls[0])).not.toContain(codigo);
    expect(res.body.correo_enviado).toBe(true);
    expect(res.body.push_enviado).toBe(true);
    expect(res.body).not.toHaveProperty('otp_dev');
  });
});

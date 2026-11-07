const express = require('express');
const request = require('supertest');

const mockClientQuery = jest.fn();
const mockRunAsSystem = jest.fn(async (_deps, fn) => {
  const result = await fn({ query: mockClientQuery });
  return result === undefined ? { rows: [{ id: 41, nombre: 'Cliente Prueba' }] } : result;
});
const mockSetEx = jest.fn();
const mockGet = jest.fn();
const mockDel = jest.fn();
const mockSendOtpEmail = jest.fn();

jest.mock('../src/config/db', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../src/config/tenantRouting', () => ({ runAsSystem: (...args) => mockRunAsSystem(...args) }));
jest.mock('../src/config/redis', () => ({
  isReady: true,
  isOpen: true,
  setEx: (...args) => mockSetEx(...args),
  get: (...args) => mockGet(...args),
  del: (...args) => mockDel(...args),
}));
jest.mock('../src/services/email.service', () => ({ sendOtpEmail: (...args) => mockSendOtpEmail(...args) }));
jest.mock('../src/services/consentService', () => ({}));
jest.mock('../src/models', () => ({ Membership: {}, BusinessProfile: {} }));

const authController = require('../src/controllers/authController');

function createApp() {
  const app = express();
  app.use(express.json());
  app.post('/forgot-password', authController.forgotPassword);
  app.post('/reset-password', authController.resetPassword);
  return app;
}

describe('password reset OTP flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunAsSystem.mockImplementation(async (_deps, fn) => {
      const result = await fn({ query: mockClientQuery });
      return result === undefined ? { rows: [{ id: 41, nombre: 'Cliente Prueba' }] } : result;
    });
    mockClientQuery.mockImplementation(async (sql) => {
      if (/SELECT id, nombre FROM usuarios/i.test(sql)) {
        return { rows: [{ id: 41, nombre: 'Cliente Prueba' }] };
      }
      if (/UPDATE usuarios SET password_hash/i.test(sql)) {
        return { rows: [{ id: 41 }], rowCount: 1 };
      }
      return { rows: [] };
    });
    mockSetEx.mockResolvedValue('OK');
    mockGet.mockResolvedValue('123456');
    mockDel.mockResolvedValue(1);
    mockSendOtpEmail.mockResolvedValue({ success: true, provider: 'brevo' });
  });

  test('solicita OTP: guarda con TTL, lo envía por correo y devuelve el éxito solo entonces', async () => {
    const res = await request(createApp()).post('/forgot-password').send({ email: ' Cliente@GlowApp.com ' });
    // Keep test diagnostics clear when an async mocked dependency rejects.

    expect(res.status).toBe(200);
    expect(mockRunAsSystem).toHaveBeenCalledTimes(1);
    expect(mockSetEx).toHaveBeenCalledWith('beauty:otp:cliente@glowapp.com', 600, expect.stringMatching(/^\d{6}$/));
    expect(mockSendOtpEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'cliente@glowapp.com',
      userName: 'Cliente Prueba',
      otp: expect.stringMatching(/^\d{6}$/),
    }));
    expect(res.body.success).toBe(true);
    expect(res.body.otp).toMatch(/^\d{6}$/);
  });

  test('no responde éxito si Redis no guarda el OTP', async () => {
    mockSetEx.mockResolvedValue(null);

    const res = await request(createApp()).post('/forgot-password').send({ email: 'cliente@glowapp.com' });

    expect(res.status).toBe(503);
    expect(mockSendOtpEmail).not.toHaveBeenCalled();
  });

  test('elimina el OTP y reporta error si falla el proveedor de correo', async () => {
    mockSendOtpEmail.mockRejectedValue(new Error('Brevo no disponible'));

    const res = await request(createApp()).post('/forgot-password').send({ email: 'cliente@glowapp.com' });

    expect(res.status).toBe(503);
    expect(mockDel).toHaveBeenCalledWith('beauty:otp:cliente@glowapp.com');
  });

  test('restablece contraseña con OTP válido mediante el rol del sistema y consume el OTP', async () => {
    const res = await request(createApp()).post('/reset-password').send({
      email: 'cliente@glowapp.com',
      otp: '123456',
      new_password: 'nueva-clave-segura',
    });

    expect(res.status).toBe(200);
    expect(mockRunAsSystem).toHaveBeenCalledTimes(1);
    expect(mockClientQuery).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE usuarios SET password_hash.*RETURNING id/i),
      [expect.stringMatching(/^\$2[aby]\$/), 'cliente@glowapp.com']
    );
    expect(mockDel).toHaveBeenCalledWith('beauty:otp:cliente@glowapp.com');
    expect(res.body.success).toBe(true);
  });

  test('no acepta un OTP incorrecto ni toca la contraseña', async () => {
    mockGet.mockResolvedValue('999999');

    const res = await request(createApp()).post('/reset-password').send({
      email: 'cliente@glowapp.com', otp: '123456', new_password: 'nueva-clave-segura',
    });

    expect(res.status).toBe(400);
    expect(mockRunAsSystem).not.toHaveBeenCalled();
  });
});

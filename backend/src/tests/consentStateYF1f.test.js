// backend/src/tests/consentStateYF1f.test.js
//
// Y-F1f — el cliente decide si pedir re-consentimiento con lo que dice este endpoint.
//
// La respuesta de `GET /api/consent/biometric/:tipo` tiene que distinguir tres cosas
// que antes se veían iguales: no autorizó, autorizó con el texto vigente y autorizó
// con un texto anterior. Si el endpoint miente en `outdated`, el cliente deja pasar a
// un usuario cuyo permiso no cubre lo que el sistema guarda hoy.

const request = require('supertest');
const express = require('express');

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.user = { id: 7, role: 'user' };
    next();
  },
}));

const mockVerifyConsent = jest.fn();
jest.mock('../middleware/biometricConsent', () => ({
  verifyConsent: (...args) => mockVerifyConsent(...args),
  getUserConsents: jest.fn(),
  grantConsent: jest.fn(),
  revokeConsent: jest.fn(),
  deleteBiometricData: jest.fn(),
  getAccessLogs: jest.fn(),
  VALID_CONSENT_TYPES: ['facial_analysis', 'skin_analysis', 'virtual_tryon'],
}));

const consentRoutes = require('../routes/biometricConsentRoutes');
const { BIOMETRIC_CONSENT_VERSION } = require('../config/consentConfig');

const app = () => {
  const a = express();
  a.use(express.json());
  a.use('/api/consent', consentRoutes);
  return a;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Y-F1f — el estado del consentimiento dice qué versión se aceptó', () => {
  test('permiso con el texto vigente: outdated false', async () => {
    mockVerifyConsent.mockResolvedValue({
      allowed: true,
      consent: { id: 1, granted: true, version_terms: BIOMETRIC_CONSENT_VERSION },
    });

    const res = await request(app()).get('/api/consent/biometric/facial_analysis');

    expect(res.status).toBe(200);
    expect(res.body.data.allowed).toBe(true);
    expect(res.body.data.outdated).toBe(false);
    expect(res.body.data.current_version).toBe(BIOMETRIC_CONSENT_VERSION);
    expect(res.body.data.consent.version_terms).toBe(BIOMETRIC_CONSENT_VERSION);
  });

  test('permiso con 2.0: allowed true pero outdated true — el cliente debe pedir aceptación', async () => {
    mockVerifyConsent.mockResolvedValue({
      allowed: true,
      consent: { id: 1, granted: true, version_terms: '2.0' },
    });

    const res = await request(app()).get('/api/consent/biometric/facial_analysis');

    expect(res.body.data.allowed).toBe(true);
    expect(res.body.data.outdated).toBe(true);
    expect(res.body.data.consent.version_terms).toBe('2.0');
  });

  test('sin consentimiento: allowed false, outdated false y consent null', async () => {
    mockVerifyConsent.mockResolvedValue({ allowed: false, reason: 'sin consentimiento', consent: null });

    const res = await request(app()).get('/api/consent/biometric/facial_analysis');

    expect(res.body.data.allowed).toBe(false);
    expect(res.body.data.outdated).toBe(false);
    expect(res.body.data.consent).toBeNull();
    // Aun sin permiso, el cliente sabe qué versión debe mostrar.
    expect(res.body.data.current_version).toBe(BIOMETRIC_CONSENT_VERSION);
  });

  test('tipo de consentimiento desconocido: 400, no una respuesta vacía', async () => {
    const res = await request(app()).get('/api/consent/biometric/iris_scan');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_consent_type');
    expect(mockVerifyConsent).not.toHaveBeenCalled();
  });
});

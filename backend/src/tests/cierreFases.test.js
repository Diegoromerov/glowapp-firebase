// backend/src/tests/cierreFases.test.js
//
// Cierre de los pendientes de Y-F1/Y-F1b/Y-F2/Y-F3:
//   1. la versión del consentimiento no puede divergir entre Dart y el backend,
//   2. un 0 medido no se convierte en el valor por defecto del GlowScore,
//   3. el tipo de piel y la base del subtono quedan guardados con el escaneo,
//   4. la ruta de la última comparación existe y está protegida.

process.env.BIOMETRIC_ENCRYPTION_KEY = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const fs = require('fs');
const path = require('path');

const mockPool = { query: jest.fn() };
jest.mock('../config/db', () => ({ pool: mockPool }));

const { BIOMETRIC_CONSENT_VERSION } = require('../config/consentConfig');
const biometricCryptoService = require('../services/biometricCryptoService');
const scanSessionService = require('../services/biometric/scanSession.service');
const orchestrator = require('../services/biometric/orchestrator');

const FACE_SCORES = {
  hydration: 55,
  wrinkles: 22,
  spots: 12,
  pores: 41,
  bioAge: 31,
  pielTipo: 'Oily',
  subtono: 'cálido',
  subtonoFuente: 'ita_hue_propio',
  subtonoMedicion: { measured: true, subtono: 'cálido', ita: 44.2, hueAngle: 58.1, samplePixels: 184320, method: 'ita-hue-propio' },
  providerTaskId: 'task-1',
  requestedActions: ['hd_moisture'],
  missing: [],
  metrics: {
    hd_moisture: { kind: 'score', raw_score: 55.4, ui_score: 55, label: null, mask_name: null, mask_url: null },
  },
};

describe('Cierre — versión del consentimiento sin divergencia', () => {
  test('la constante Dart coincide con BIOMETRIC_CONSENT_VERSION', () => {
    const dartPath = path.join(__dirname, '..', '..', '..', 'frontend', 'lib', 'services', 'biometric_service.dart');
    const source = fs.readFileSync(dartPath, 'utf8');
    const match = source.match(/consentVersion\s*=\s*'([^']+)'/);

    expect(match).not.toBeNull();
    expect(match[1]).toBe(BIOMETRIC_CONSENT_VERSION);
  });
});

describe('Cierre — un 0 medido no es un dato ausente', () => {
  test('calculateGlowScore respeta hydration 0 en vez de sustituirla por 60', () => {
    const conCero = orchestrator.calculateGlowScore({ hydration: 0, wrinkles: 0, spots: 0, pores: 0 });
    // 0*0.35 + 100*0.25 + 100*0.25 + 100*0.15 = 65 (con el fallback viejo daba 68)
    expect(conCero).toBe(65);
  });

  test('un valor ausente sí usa el valor por defecto', () => {
    const sinDatos = orchestrator.calculateGlowScore({});
    // 60*0.35 + 80*0.25 + 65*0.25 + 70*0.15 = 67.75 -> 68
    expect(sinDatos).toBe(68);
  });
});

describe('Cierre — el historial conserva tipo de piel y base del subtono', () => {
  test('la sesión guardada incluye pielTipo, fuente y medición completa', async () => {
    mockPool.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM biometric_consents')) return { rows: [{ version_terms: '2.0' }] };
      if (sql.includes('INSERT INTO biometric_scan_sessions')) {
        return { rows: [{ id: 12, captured_at: '2026-10-19T00:00:00Z' }] };
      }
      return { rows: [] };
    });

    const result = await scanSessionService.saveScan({ userId: 7, faceScores: FACE_SCORES });
    expect(result.persisted).toBe(true);

    const insert = mockPool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO biometric_scan_sessions'));
    const encrypted = insert[1][2];
    const payload = biometricCryptoService.decrypt(encrypted);

    expect(payload.skin.pielTipo).toBe('Oily');
    expect(payload.skin.subtono).toBe('cálido');
    expect(payload.skin.subtonoFuente).toBe('ita_hue_propio');
    expect(payload.skin.medicion.ita).toBe(44.2);
    expect(payload.skin.medicion.samplePixels).toBe(184320);
    // El bloque legacy sigue intacto para no romper a quien ya lo lee
    expect(payload.legacy.hydration).toBe(55);
  });

  test('sin medición guarda fuente no_medido y medicion null', async () => {
    mockPool.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM biometric_consents')) return { rows: [{ version_terms: '2.0' }] };
      if (sql.includes('INSERT INTO biometric_scan_sessions')) {
        return { rows: [{ id: 13, captured_at: '2026-10-19T00:00:00Z' }] };
      }
      return { rows: [] };
    });

    const sinMedicion = { ...FACE_SCORES, subtono: null, subtonoFuente: undefined, subtonoMedicion: undefined, pielTipo: null };
    await scanSessionService.saveScan({ userId: 7, faceScores: sinMedicion });

    const insert = mockPool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO biometric_scan_sessions'));
    const payload = biometricCryptoService.decrypt(insert[1][2]);
    expect(payload.skin.subtono).toBeNull();
    expect(payload.skin.subtonoFuente).toBe('no_medido');
    expect(payload.skin.medicion).toBeNull();
  });
});

describe('Cierre — ruta de la última comparación', () => {
  // Se verifica sobre el fuente en vez de levantar el router: el guard de auth de este
  // repo consulta Redis/DB y en pruebas sin infraestructura deja la petición colgada.
  const routeSource = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'biometricRoutes.js'),
    'utf8'
  );

  test('la ruta existe, está protegida y delega en el servicio', () => {
    expect(routeSource).toMatch(/router\.get\('\/delta\/latest',\s*authMiddleware/);
    expect(routeSource).toMatch(/scanComparisonService\.getLatest/);
    expect(routeSource).toMatch(/error:\s*'NO_COMPARISONS'/);
  });

  test('el servicio expone getLatest y descifra el detalle', () => {
    const serviceSource = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'biometric', 'scanComparison.service.js'),
      'utf8'
    );
    expect(serviceSource).toMatch(/async getLatest\(userId\)/);
    expect(serviceSource).toMatch(/biometricCryptoService\.decrypt/);
  });
});

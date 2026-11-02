// backend/src/tests/geometryYF4.orchestrator.test.js
//
// Y-F4 — el orquestador como backstop del cliente.
//
// Dos cosas que sólo se pueden probar aquí:
//   * una foto con geometría mala no llega al proveedor (no se gasta unidad), y
//   * una buena sí pasa y queda guardada con la sesión, con la geometría declarada.

process.env.BIOMETRIC_ENCRYPTION_KEY = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const sharp = require('sharp');

const mockPool = { query: jest.fn(async () => ({ rows: [] })) };
jest.mock('../config/db', () => ({ pool: mockPool }));

jest.mock('../services/biometric/profile.service', () => ({
  saveProfile: jest.fn(async () => ({ id: 91 })),
}));

jest.mock('../services/biometric/youcam.client', () => ({
  analyzeFace: jest.fn(),
}));

jest.mock('../services/biometric/gemini.client', () => ({
  analyzeHands: jest.fn(async () => ({ handsScore: 70, hydration: 'media' })),
  generateRecommendation: jest.fn(async () => 'Rutina sugerida'),
}));

jest.mock('../services/biometric/deepseek.client', () => ({
  generateRecommendation: jest.fn(async () => 'Rutina DeepSeek'),
  getVtoToneMatching: jest.fn(async () => ({ warm: ['#C97B63'] })),
}));

jest.mock('../services/openUV', () => ({ getUV: jest.fn(async () => null) }));

const youcamClient = require('../services/biometric/youcam.client');
const profileService = require('../services/biometric/profile.service');
const geminiClient = require('../services/biometric/gemini.client');
const deepseekClient = require('../services/biometric/deepseek.client');
const openUV = require('../services/openUV');
const scanSessionService = require('../services/biometric/scanSession.service');
const orchestrator = require('../services/biometric/orchestrator');

const GEOMETRIA_OK = { yaw: 2, roll: -1, pitch: 3, faceRatio: 0.42, aspectRatio: 1.2, centerOffset: 0.04 };

const FACE_SCORES = {
  hydration: 61,
  wrinkles: 24,
  spots: 11,
  pores: 38,
  bioAge: 30,
  pielTipo: 'Combination',
  subtono: null,
  subtonoFuente: 'no_medido',
  providerTaskId: 'task-geo-1',
  requestedActions: ['hd_moisture'],
  missing: [],
  metrics: {
    hd_moisture: { kind: 'score', raw_score: 61.2, ui_score: 61, label: null, mask_name: null, mask_url: null },
  },
  masks: [],
};

let foto;

beforeAll(async () => {
  const cuadros = [];
  for (let y = 0; y < 1600; y += 40) {
    for (let x = 0; x < 1200; x += 40) {
      if ((x / 40 + y / 40) % 2 === 0) cuadros.push(`<rect x="${x}" y="${y}" width="40" height="40" fill="#f0e6dc"/>`);
    }
  }
  const svg =
    `<svg width="1200" height="1600"><rect width="1200" height="1600" fill="#8a6b52"/>` +
    `${cuadros.join('')}<circle cx="600" cy="760" r="220" fill="#d9c0a8"/></svg>`;
  foto = await sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
});

beforeEach(() => {
  jest.clearAllMocks();
  // `jest.config.js` tiene resetMocks/restoreMocks: las implementaciones se reinstalan aquí.
  mockPool.query.mockImplementation(async () => ({ rows: [] }));
  profileService.saveProfile.mockResolvedValue({ id: 91 });
  youcamClient.analyzeFace.mockResolvedValue({ ...FACE_SCORES, metrics: { ...FACE_SCORES.metrics } });
  geminiClient.analyzeHands.mockResolvedValue({ handsScore: 70, hydration: 'media' });
  geminiClient.generateRecommendation.mockResolvedValue('Rutina sugerida');
  deepseekClient.generateRecommendation.mockResolvedValue('Rutina DeepSeek');
  deepseekClient.getVtoToneMatching.mockResolvedValue({ warm: ['#C97B63'] });
  openUV.getUV.mockResolvedValue(null);
  // Sin sesiones previas: cada prueba mide de cero.
  scanSessionService.findReusableScan = jest.fn(async () => null);
  scanSessionService.saveScan = jest.fn(async () => ({ id: 501, persisted: true, metricsCount: 1 }));
  scanSessionService.getPrevious = jest.fn(async () => null);
  scanSessionService.getCacheTtlHours = jest.fn(() => 24);
});

describe('Y-F4 — el servidor no confía en el cliente', () => {
  test('rostro girado: 422 con el motivo y cero llamadas al proveedor', async () => {
    await expect(
      orchestrator.analyze(901, foto, null, 'ideas', null, null, 'trace-geo-1', { ...GEOMETRIA_OK, yaw: 38 })
    ).rejects.toMatchObject({
      code: 'CAPTURE_REJECTED',
      statusCode: 422,
    });

    expect(youcamClient.analyzeFace).not.toHaveBeenCalled();
    expect(scanSessionService.saveScan).not.toHaveBeenCalled();
  });

  test('el 422 dice qué pasó y con qué número, no un mensaje genérico', async () => {
    const error = await orchestrator
      .analyze(902, foto, null, 'ideas', null, null, 'trace-geo-2', { ...GEOMETRIA_OK, faceRatio: 0.08 })
      .catch((e) => e);

    expect(error.details.geometry.motivos[0].code).toBe('ROSTRO_LEJOS');
    expect(error.details.metrics.faceRatio).toBeCloseTo(0.08, 5);
  });

  test('geometría buena: se mide y la sesión guarda el veredicto del servidor', async () => {
    const r = await orchestrator.analyze(903, foto, null, 'ideas', null, null, 'trace-geo-3', GEOMETRIA_OK);

    expect(youcamClient.analyzeFace).toHaveBeenCalledTimes(1);
    expect(r.captureGeometry.veredicto).toBe('ACEPTADA');
    expect(r.captureGeometry.provista).toBe(true);
    expect(scanSessionService.saveScan).toHaveBeenCalledWith(
      expect.objectContaining({
        geometry: expect.objectContaining({
          cliente: expect.objectContaining({ veredicto: 'ACEPTADA', provista: true }),
        }),
      })
    );
  });

  test('sin geometría se mide igual, pero la respuesta admite que no se verificó', async () => {
    const r = await orchestrator.analyze(904, foto, null, 'ideas', null, null, 'trace-geo-4', null);

    expect(youcamClient.analyzeFace).toHaveBeenCalledTimes(1);
    expect(r.captureGeometry).toEqual({ provista: false, veredicto: 'SIN_GEOMETRIA', metricas: {} });
  });

  test('en modo estricto, sin geometría no se gasta unidad', async () => {
    process.env.BIOMETRIC_REQUIRE_GEOMETRY = 'true';
    try {
      await expect(
        orchestrator.analyze(905, foto, null, 'ideas', null, null, 'trace-geo-5', null)
      ).rejects.toMatchObject({ code: 'CAPTURE_REJECTED' });
      expect(youcamClient.analyzeFace).not.toHaveBeenCalled();
    } finally {
      delete process.env.BIOMETRIC_REQUIRE_GEOMETRY;
    }
  });
});

// backend/src/tests/deltaYF3.test.js
//
// Y-F3 — Cambio medido contra el baseline propio.
//   * el umbral separa cambio real de ruido, sobre raw_score,
//   * solo las métricas con escala documentada reciben juicio mejora/empeora,
//   * los grupos por familia y por zona no inventan métricas ausentes,
//   * la comparación se guarda cifrada y no se puede duplicar para el mismo escaneo,
//   * el orquestador compara con el escaneo anterior y devuelve el veredicto.

const sharp = require('sharp');

jest.mock('../services/biometric/profile.service', () => ({ saveProfile: jest.fn() }));
jest.mock('../services/biometric/scanSession.service', () => ({
  saveScan: jest.fn(),
  getPrevious: jest.fn(),
  // Y-F5: el orquestador consulta la caché antes de llamar al proveedor.
  findReusableScan: jest.fn(),
  restoreFaceScores: jest.fn((payload) => payload),
  getCacheTtlHours: jest.fn(() => 24),
}));
jest.mock('../services/biometric/scanComparison.service', () => ({ save: jest.fn(), getLatest: jest.fn() }));
jest.mock('../services/biometric/youcam.client', () => ({ analyzeFace: jest.fn() }));
jest.mock('../services/biometric/gemini.client', () => ({
  analyzeHands: jest.fn(),
  generateRecommendation: jest.fn(),
}));
jest.mock('../services/biometric/deepseek.client', () => ({
  generateRecommendation: jest.fn(),
  getVtoToneMatching: jest.fn(),
}));

process.env.BIOMETRIC_ENCRYPTION_KEY = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const deltaService = require('../services/biometric/delta.service');
const scanComparisonService = require('../services/biometric/scanComparison.service');
const scanSessionService = require('../services/biometric/scanSession.service');
const profileService = require('../services/biometric/profile.service');
const youcam = require('../services/biometric/youcam.client');
const gemini = require('../services/biometric/gemini.client');
const deepseek = require('../services/biometric/deepseek.client');
const orchestrator = require('../services/biometric/orchestrator');

/** Métrica con raw_score y ui_score, como las deja youcam.client. */
const metric = (raw, ui = Math.round(raw), mask = null) => ({
  kind: 'score',
  raw_score: raw,
  ui_score: ui,
  label: null,
  mask_name: mask,
  mask_url: null,
});

describe('Y-F3 — comparación de métricas', () => {
  test('el cambio por debajo del umbral es ruido, no mejora', () => {
    const { comparisons } = deltaService.compareMetrics(
      { hd_moisture: metric(40.0) },
      { hd_moisture: metric(41.4) },
      { threshold: 2 }
    );

    expect(comparisons[0].delta).toBe(1.4);
    expect(comparisons[0].significant).toBe(false);
    expect(comparisons[0].change).toBe('sin_cambio');
  });

  test('hidratación que sube 20 puntos es mejora; arruga que sube 20 es empeora', () => {
    const { comparisons } = deltaService.compareMetrics(
      { hd_moisture: metric(40), 'hd_wrinkle.whole': metric(20) },
      { hd_moisture: metric(60), 'hd_wrinkle.whole': metric(40) },
      { threshold: 2 }
    );

    const hidratacion = comparisons.find((c) => c.key === 'hd_moisture');
    const arruga = comparisons.find((c) => c.key === 'hd_wrinkle.whole');

    expect(hidratacion.change).toBe('mejora');
    expect(hidratacion.delta).toBe(20);
    expect(arruga.change).toBe('empeora');
    expect(arruga.polarity).toBe('mayor_peor');
  });

  test('una métrica sin polaridad documentada no recibe juicio', () => {
    const { comparisons } = deltaService.compareMetrics(
      { 'hd_texture.whole': metric(50) },
      { 'hd_texture.whole': metric(65) },
      { threshold: 2 }
    );

    expect(comparisons[0].polarity).toBe('no_declarada');
    expect(comparisons[0].change).toBe('cambio_medido');
  });

  test('usa raw_score y cae a ui_score solo si falta', () => {
    const { comparisons } = deltaService.compareMetrics(
      { 'hd_pore.nose': metric(29.139814376831055) },
      { 'hd_pore.nose': { kind: 'score', raw_score: null, ui_score: 60 } },
      { threshold: 2 }
    );

    expect(comparisons[0].before).toBe(29.1);
    expect(comparisons[0].after).toBe(60);
  });

  test('métricas que solo existen en un lado no se comparan', () => {
    const { comparisons, onlyInBaseline, onlyInCurrent } = deltaService.compareMetrics(
      { hd_moisture: metric(40), hd_acne: metric(10) },
      { hd_moisture: metric(50), 'hd_tear_trough.whole': metric(30) },
      { threshold: 2 }
    );

    expect(comparisons).toHaveLength(1);
    expect(onlyInBaseline).toEqual(['hd_acne']);
    expect(onlyInCurrent).toEqual(['hd_tear_trough.whole']);
  });

  test('veredicto global, GlowScore y grupos', () => {
    const previo = {
      metrics: {
        hd_moisture: metric(40),
        'hd_wrinkle.whole': metric(20),
        'hd_pore.forehead': metric(70),
        'hd_texture.whole': metric(60),
      },
      legacy: { hydration: 40, wrinkles: 20, spots: 5, pores: 70 },
      capturedAt: '2026-10-01T10:00:00.000Z',
    };
    const actual = {
      metrics: {
        hd_moisture: metric(62),
        'hd_wrinkle.whole': metric(18),
        'hd_pore.forehead': metric(50),
        'hd_texture.whole': metric(60.5),
      },
      capturedAt: '2026-10-15T10:00:00.000Z',
    };

    const result = deltaService.compareScans({
      previous: previo,
      current: actual,
      glowScoreBefore: 55,
      glowScoreAfter: 63,
      threshold: 2,
    });

    expect(result.threshold).toBe(2);
    expect(result.compared).toBe(4);
    expect(result.significant).toBe(3); // hidratación, arruga y poros; textura queda en ruido
    expect(result.verdict).toBe('MEJORO');
    expect(result.glowScore.delta).toBe(8);
    expect(result.glowScore.significant).toBe(true);
    expect(result.byFamily.hidratacion.deltaMedio).toBe(22);
    expect(result.byFamily.poros.mejoras).toBe(1);
    expect(result.byZone.forehead.metrics).toBe(1);
    expect(result.byZone.whole.metrics).toBe(3);
    expect(result.notes.join(' ')).toMatch(/no es un diagnóstico médico/);
  });

  test('sin cambios por encima del umbral el veredicto es SIN_CAMBIO', () => {
    const previo = { metrics: { hd_moisture: metric(40) }, capturedAt: '2026-10-01T00:00:00Z' };
    const actual = { metrics: { hd_moisture: metric(41) }, capturedAt: '2026-10-08T00:00:00Z' };

    const result = deltaService.compareScans({
      previous: previo, current: actual, glowScoreBefore: 60, glowScoreAfter: 60.5, threshold: 2,
    });

    expect(result.verdict).toBe('SIN_CAMBIO');
    expect(result.significant).toBe(0);
  });

  test('mezcla de mejoras y empeoras da MIXTO', () => {
    const previo = { metrics: { hd_moisture: metric(40), 'hd_wrinkle.whole': metric(10) }, capturedAt: '2026-10-01T00:00:00Z' };
    const actual = { metrics: { hd_moisture: metric(60), 'hd_wrinkle.whole': metric(30) }, capturedAt: '2026-10-08T00:00:00Z' };

    const result = deltaService.compareScans({
      previous: previo, current: actual, glowScoreBefore: 60, glowScoreAfter: 60, threshold: 2,
    });

    expect(result.verdict).toBe('MIXTO');
  });
});

describe('Y-F3 — persistencia de la comparación', () => {
  // El servicio está mockeado para el bloque del orquestador: aquí se usa el real.
  const realScanComparisonService = jest.requireActual('../services/biometric/scanComparison.service');
  const pool = require('../config/db').pool;

  test('guarda el detalle cifrado y los contadores en claro', async () => {
    pool.query = jest.fn().mockResolvedValue({ rows: [{ id: 9, created_at: '2026-10-19T00:00:00Z' }] });

    const result = deltaService.compareScans({
      previous: { metrics: { hd_moisture: metric(40) }, capturedAt: '2026-10-01T00:00:00Z' },
      current: { metrics: { hd_moisture: metric(60) }, capturedAt: '2026-10-08T00:00:00Z' },
      glowScoreBefore: 50,
      glowScoreAfter: 60,
      threshold: 2,
    });

    const saved = await realScanComparisonService.save({
      userId: 7, baselineScanId: 100, currentScanId: 101, result,
    });

    expect(saved.persisted).toBe(true);
    expect(saved.id).toBe(9);

    const [, params] = pool.query.mock.calls[0];
    const [userId, baseline, current, threshold, verdict, compared, significant, encrypted] = params;
    expect(userId).toBe(7);
    expect(baseline).toBe(100);
    expect(current).toBe(101);
    expect(Number(threshold)).toBe(2);
    expect(verdict).toBe('MEJORO');
    expect(compared).toBe(1);
    expect(significant).toBe(1);
    expect(encrypted.includes('hd_moisture')).toBe(false);

    const decrypted = require('../services/biometricCryptoService').decrypt(encrypted);
    expect(decrypted.comparisons[0].delta).toBe(20);
    expect(decrypted.verdict).toBe('MEJORO');
  });

  test('un escaneo no se compara consigo mismo', async () => {
    const saved = await realScanComparisonService.save({
      userId: 7, baselineScanId: 100, currentScanId: 100, result: { threshold: 2 },
    });

    expect(saved.persisted).toBe(false);
    expect(saved.reason).toMatch(/mismo escaneo/);
  });
});

describe('Y-F3 — el orquestador devuelve el veredicto contra el escaneo anterior', () => {
  async function imagenValida() {
    const width = 1200;
    const height = 1600;
    const channels = 3;
    const raw = Buffer.alloc(width * height * channels);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? 0 : 255;
        const idx = (y * width + x) * channels;
        raw[idx] = value;
        raw[idx + 1] = value;
        raw[idx + 2] = value;
      }
    }
    return sharp(raw, { raw: { width, height, channels } }).png().toBuffer();
  }

  beforeEach(() => {
    jest.clearAllMocks();

    // Y-F5: sin foto previa, el análisis va al proveedor como antes.
    scanSessionService.findReusableScan.mockResolvedValue(null);
    scanSessionService.getCacheTtlHours.mockReturnValue(24);

    profileService.saveProfile.mockResolvedValue({ id: 999, createdAt: '2026-10-19T00:00:00Z' });
    youcam.analyzeFace.mockResolvedValue({
      hydration: 62,
      wrinkles: 18,
      spots: 5,
      pores: 50,
      pielTipo: 'Oily',
      subtono: null,
      bioAge: 30,
      providerTaskId: 'task-9',
      requestedActions: [],
      missing: [],
      metrics: {
        hd_moisture: metric(62),
        'hd_wrinkle.whole': metric(18),
      },
    });
    gemini.analyzeHands.mockResolvedValue({
      manchasSolares: 'leve', sequedad: 'leve', cuticulas: 'sanas', unas: 'sanas', edadAparente: 30,
    });
    deepseek.generateRecommendation.mockResolvedValue('Recomendación de prueba.');
    deepseek.getVtoToneMatching.mockResolvedValue({ lipsticks: [], nails: [] });

    scanSessionService.saveScan.mockResolvedValue({
      persisted: true, id: 501, capturedAt: '2026-10-19T00:00:00Z', metricsCount: 2,
      consentVersion: '2.0', consentOutdated: false,
    });
    scanSessionService.getPrevious.mockResolvedValue({
      id: 500,
      capturedAt: '2026-10-01T00:00:00Z',
      payload: {
        metrics: { hd_moisture: metric(40), 'hd_wrinkle.whole': metric(30) },
        legacy: { hydration: 40, wrinkles: 30, spots: 8, pores: 55 },
      },
    });
    scanComparisonService.save.mockResolvedValue({ persisted: true, id: 77 });
  });

  test('compara contra el escaneo anterior y persiste la comparación', async () => {
    const face = await imagenValida();

    const result = await orchestrator.analyze(7, face, null, 'ideas');

    expect(scanSessionService.getPrevious).toHaveBeenCalledWith(7, 501);
    expect(scanComparisonService.save).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7,
      baselineScanId: 500,
      currentScanId: 501,
    }));

    expect(result.delta.verdict).toBe('MEJORO');
    expect(result.delta.baselineScanId).toBe(500);
    expect(result.delta.comparisonId).toBe(77);
    expect(result.delta.persisted).toBe(true);

    const hidratacion = result.delta.comparisons.find((c) => c.key === 'hd_moisture');
    expect(hidratacion.delta).toBe(22);
    expect(hidratacion.change).toBe('mejora');
  });

  test('primer escaneo: SIN_BASELINE, sin inventar mejora', async () => {
    scanSessionService.getPrevious.mockResolvedValue(null);
    const face = await imagenValida();

    const result = await orchestrator.analyze(7, face, null, 'ideas');

    expect(result.delta.verdict).toBe('SIN_BASELINE');
    expect(result.delta.compared).toBe(0);
    expect(scanComparisonService.save).not.toHaveBeenCalled();
  });
});

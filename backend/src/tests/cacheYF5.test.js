// backend/src/tests/cacheYF5.test.js
//
// Y-F5 — No pagar dos veces la misma foto.
//   * huella determinista (sha256) y tolerante al re-encoding (dHash),
//   * acierto de caché = cero llamadas al proveedor,
//   * jamás se reutiliza métricas de otro usuario,
//   * ventana vencida = se analiza de nuevo,
//   * si la lectura falla se analiza igual (fail-open),
//   * el delta avisa cuando la medición se reutilizó.

process.env.BIOMETRIC_ENCRYPTION_KEY = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const sharp = require('sharp');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// --- Base de datos en memoria que entiende las dos consultas del servicio ---------
// `resetMocks: true` (jest.config.js) borra las implementaciones antes de cada prueba,
// así que la implementación vive en una función y se reinstala en `beforeEach`.
const store = [];

function dbQuery(sql, params = []) {
  if (/INSERT INTO biometric_scan_sessions/.test(sql)) {
    const row = {
      id: store.length + 1,
      user_id: params[0],
      metrics_encrypted: params[2],
      image_hash: params[10],
      captured_at: new Date(),
    };
    store.push(row);
    return Promise.resolve({ rows: [{ id: row.id, captured_at: row.captured_at }] });
  }

  if (/FROM biometric_scan_sessions/.test(sql)) {
    // Y-F5: la búsqueda trae las últimas sesiones del usuario y el servicio descifra.
    const [userId] = params;
    return Promise.resolve({ rows: store.filter((r) => r.user_id === userId) });
  }

  if (/FROM biometric_consents/.test(sql)) {
    return Promise.resolve({ rows: [{ version_terms: '2.0' }] });
  }

  return Promise.resolve({ rows: [] });
}

const mockPool = { query: jest.fn() };

jest.mock('../config/db', () => ({ pool: mockPool }));

jest.mock('../services/biometric/profile.service', () => ({
  saveProfile: jest.fn(async () => ({ id: 77 })),
}));

jest.mock('../services/biometric/youcam.client', () => ({
  analyzeFace: jest.fn(),
}));

jest.mock('../services/biometric/gemini.client', () => ({
  analyzeHands: jest.fn(async () => ({ handsScore: 70, hydration: 'media' })),
  generateRecommendation: jest.fn(async () => 'Rutina sugerida de prueba'),
}));

jest.mock('../services/biometric/deepseek.client', () => ({
  generateRecommendation: jest.fn(async () => 'Rutina DeepSeek de prueba'),
  getVtoToneMatching: jest.fn(async () => ({ warm: ['#C97B63'] })),
}));

jest.mock('../services/openUV', () => ({ getUV: jest.fn(async () => null) }));

const imageHashService = require('../services/biometric/imageHash.service');
const scanSessionService = require('../services/biometric/scanSession.service');
const biometricCryptoService = require('../services/biometricCryptoService');
const youcamClient = require('../services/biometric/youcam.client');
const profileService = require('../services/biometric/profile.service');
const geminiClient = require('../services/biometric/gemini.client');
const deepseekClient = require('../services/biometric/deepseek.client');
const openUV = require('../services/openUV');
const orchestrator = require('../services/biometric/orchestrator');

const FACE_SCORES = {
  hydration: 61,
  wrinkles: 24,
  spots: 11,
  pores: 38,
  bioAge: 30,
  pielTipo: 'Combination',
  subtono: null,
  subtonoFuente: 'no_medido',
  providerTaskId: 'task-cache-1',
  requestedActions: ['hd_moisture'],
  missing: [],
  metrics: {
    hd_moisture: { kind: 'score', raw_score: 61.2, ui_score: 61, label: null, mask_name: null, mask_url: null },
    'hd_wrinkle.whole': { kind: 'score', raw_score: 24.4, ui_score: 24, label: null, mask_name: null, mask_url: null },
  },
  masks: [{ action: 'hd_moisture', url: 'https://example.test/mask.png' }],
};

let fotoA;
let fotoB;

/**
 * Foto con detalle de alta frecuencia: la puerta de calidad (Y-F2) rechaza una imagen
 * plana por falta de nitidez, así que el fixture necesita bordes reales.
 */
async function fotoConDetalle({ phase = 0, rostroX = 430, fondo = '#8a6b52' } = {}) {
  const cuadros = [];
  for (let y = 0; y < 1600; y += 40) {
    for (let x = 0; x < 1200; x += 40) {
      if ((x / 40 + y / 40 + phase) % 2 === 0) {
        cuadros.push(`<rect x="${x}" y="${y}" width="40" height="40" fill="#f0e6dc"/>`);
      }
    }
  }
  const svg =
    `<svg width="1200" height="1600"><rect width="1200" height="1600" fill="${fondo}"/>` +
    `${cuadros.join('')}<circle cx="${rostroX}" cy="760" r="220" fill="#d9c0a8"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}

beforeAll(async () => {
  fotoA = await fotoConDetalle({ phase: 0, rostroX: 430 });
  fotoB = await fotoConDetalle({ phase: 1, rostroX: 780, fondo: '#4a3a2c' });
});

beforeEach(() => {
  store.length = 0;
  jest.clearAllMocks();

  // Las implementaciones se reinstalan aquí porque jest.config.js usa resetMocks.
  mockPool.query.mockImplementation(dbQuery);
  profileService.saveProfile.mockResolvedValue({ id: 77 });
  youcamClient.analyzeFace.mockResolvedValue({ ...FACE_SCORES, metrics: { ...FACE_SCORES.metrics } });
  geminiClient.analyzeHands.mockResolvedValue({ handsScore: 70, hydration: 'media' });
  geminiClient.generateRecommendation.mockResolvedValue('Rutina sugerida de prueba');
  deepseekClient.generateRecommendation.mockResolvedValue('Rutina DeepSeek de prueba');
  deepseekClient.getVtoToneMatching.mockResolvedValue({ warm: ['#C97B63'] });
  openUV.getUV.mockResolvedValue(null);
});

describe('Y-F5 — huella de la foto', () => {
  test('la misma imagen da el mismo hash exacto', async () => {
    const a = await imageHashService.fingerprint(fotoA);
    const b = await imageHashService.fingerprint(fotoA);

    expect(a.hmac).toBe(b.hmac);
    expect(a.dhash).toBe(b.dhash);
    expect(a.dhash).toMatch(/^[0-9a-f]{16}$/);
    expect(a.hmac).toHaveLength(64);
  });

  test('la misma foto con re-encoding distinto se reconoce por dHash', async () => {
    const original = await imageHashService.fingerprint(fotoA);
    const recomprimida = await sharp(fotoA).jpeg({ quality: 55 }).toBuffer();
    const otraHuella = await imageHashService.fingerprint(recomprimida);

    expect(otraHuella.hmac).not.toBe(original.hmac);
    const veredicto = imageHashService.isSamePhoto(original, otraHuella);
    expect(veredicto.same).toBe(true);
    expect(veredicto.reason).toBe('perceptual');
    expect(veredicto.distance).toBeLessThanOrEqual(imageHashService.DEFAULT_HAMMING_THRESHOLD);
  });

  test('una foto distinta no se confunde', async () => {
    const original = await imageHashService.fingerprint(fotoA);
    const distinta = await imageHashService.fingerprint(fotoB);
    const veredicto = imageHashService.isSamePhoto(original, distinta);

    expect(veredicto.distance).toBeGreaterThan(imageHashService.DEFAULT_HAMMING_THRESHOLD);
    expect(veredicto.same).toBe(false);
  });

  test('una imagen ilegible no rompe: devuelve la huella que pueda', async () => {
    const huella = await imageHashService.fingerprint(Buffer.from('no-soy-una-imagen'));
    expect(huella.hmac).toHaveLength(64);
    expect(huella.dhash).toBeNull();
  });
});

describe('Y-F5 — reutilización', () => {
  test('la primera vez analiza y guarda la huella; la segunda no llama al proveedor', async () => {
    const primera = await orchestrator.analyze(501, fotoA, null, 'ideas', null, null, 'trace-cache-1');

    expect(youcamClient.analyzeFace).toHaveBeenCalledTimes(1);
    expect(primera.cache.hit).toBe(false);
    expect(store[0].image_hash).toHaveLength(64);

    // Privacidad: lo que queda en la columna NO es el sha256 de la foto ni un descriptor
    // en claro; el dHash viaja dentro del cifrado.
    const sha256Desnudo = crypto.createHash('sha256').update(fotoA).digest('hex');
    expect(store[0].image_hash).not.toBe(sha256Desnudo);
    const payload = biometricCryptoService.decrypt(store[0].metrics_encrypted);
    expect(payload.fingerprint.dhash).toMatch(/^[0-9a-f]{16}$/);
    expect(store[0].metrics_encrypted).not.toContain(payload.fingerprint.dhash);

    const segunda = await orchestrator.analyze(501, fotoA, null, 'ideas', null, null, 'trace-cache-2');

    // No se volvió a pagar la unidad
    expect(youcamClient.analyzeFace).toHaveBeenCalledTimes(1);
    expect(segunda.cache.hit).toBe(true);
    expect(segunda.cache.reusedScanId).toBe(1);
    expect(segunda.cache.match).toBe('hash_exacto');
    expect(segunda.cache.ttlHours).toBe(24);
    expect(segunda.metricsCount).toBe(2);
    // Y-F5 (auditoría): la foto repetida no crea una medición nueva en la serie.
    expect(segunda.scanSessionId).toBeNull();
    expect(store).toHaveLength(1);
  });

  test('el acierto reutiliza el GlowScore y no inventa un delta', async () => {
    const primera = await orchestrator.analyze(502, fotoA, null, 'ideas');
    const segunda = await orchestrator.analyze(502, fotoA, null, 'ideas');

    expect(segunda.cache.hit).toBe(true);
    expect(segunda.glowScore).toBe(primera.glowScore);
    // Comparar una foto consigo misma no es un cambio medido: no hay delta ni fila nueva.
    expect(segunda.delta).toBeNull();
    expect(store).toHaveLength(1);
  });

  test('la misma foto de otro usuario NO se reutiliza', async () => {
    await orchestrator.analyze(601, fotoA, null, 'ideas');
    const otro = await orchestrator.analyze(602, fotoA, null, 'ideas');

    expect(youcamClient.analyzeFace).toHaveBeenCalledTimes(2);
    expect(otro.cache.hit).toBe(false);
    expect(otro.cache.reusedScanId).toBeNull();
  });

  test('una foto distinta del mismo usuario se analiza de nuevo', async () => {
    await orchestrator.analyze(701, fotoA, null, 'ideas');
    const distinta = await orchestrator.analyze(701, fotoB, null, 'ideas');

    expect(youcamClient.analyzeFace).toHaveBeenCalledTimes(2);
    expect(distinta.cache.hit).toBe(false);
  });

  test('ventana en 0 desactiva la caché sin tocar código', async () => {
    await orchestrator.analyze(801, fotoA, null, 'ideas');

    process.env.BIOMETRIC_CACHE_TTL_HOURS = '0';
    const segunda = await orchestrator.analyze(801, fotoA, null, 'ideas');
    delete process.env.BIOMETRIC_CACHE_TTL_HOURS;

    expect(youcamClient.analyzeFace).toHaveBeenCalledTimes(2);
    expect(segunda.cache.hit).toBe(false);
    expect(segunda.cache.ttlHours).toBe(0);
  });

  test('si la búsqueda falla se analiza igual (fail-open)', async () => {
    await orchestrator.analyze(901, fotoA, null, 'ideas');

    const original = mockPool.query.getMockImplementation();
    mockPool.query.mockImplementation(async (sql, params) => {
      if (/image_hash/.test(sql)) throw new Error('base caída');
      return original(sql, params);
    });

    const segunda = await orchestrator.analyze(901, fotoA, null, 'ideas');

    mockPool.query.mockImplementation(original);

    expect(segunda.cache.hit).toBe(false);
    expect(youcamClient.analyzeFace).toHaveBeenCalledTimes(2);
  });

  test('restoreFaceScores devuelve la forma plana que espera el orquestador', () => {
    const restaurado = scanSessionService.restoreFaceScores({
      metrics: FACE_SCORES.metrics,
      legacy: { hydration: 61, wrinkles: 24, spots: 11, pores: 38, subtono: null, bioAge: 30 },
      skin: { pielTipo: 'Combination', subtono: 'cálido', subtonoFuente: 'ita_hue_propio', medicion: { ita: 44 } },
      masks: [],
      requestedActions: ['hd_moisture'],
      missing: [],
    });

    expect(restaurado.hydration).toBe(61);
    expect(restaurado.pielTipo).toBe('Combination');
    expect(restaurado.subtono).toBe('cálido');
    expect(restaurado.subtonoMedicion.ita).toBe(44);
    expect(Object.keys(restaurado.metrics)).toHaveLength(2);
    expect(restaurado.reutilizado).toBe(true);
    expect(orchestrator.calculateGlowScore(restaurado)).toBeGreaterThan(0);
  });
});

describe('Y-F5 — migración 104', () => {
  test('añade la columna indexada y es re-aplicable; el descriptor NO queda en claro', () => {
    const { newDb } = require('pg-mem');
    const db = newDb();
    const pg = db.public;

    const migrations = ['100_create_biometric_scan_sessions.sql', '104_add_image_fingerprint_to_scan_sessions.sql']
      .map((name) => fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', name), 'utf8'));

    for (const sql of migrations) pg.none(sql);
    // idempotente
    pg.none(migrations[1]);

    pg.none(`INSERT INTO biometric_scan_sessions
      (user_id, metrics_encrypted, metrics_count, image_hash)
      VALUES (1, 'cifrado', 2, 'abc123')`);

    const [row] = pg.many(`SELECT image_hash FROM biometric_scan_sessions`);
    expect(row.image_hash).toBe('abc123');

    // El descriptor perceptual no tiene columna propia: va dentro del payload cifrado.
    const columnas = pg.many(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'biometric_scan_sessions' AND column_name LIKE 'image_%'`
    ).map((c) => c.column_name);
    expect(columnas).toEqual(['image_hash']);
  });
});

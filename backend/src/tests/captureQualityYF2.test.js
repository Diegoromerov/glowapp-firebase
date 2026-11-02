// backend/src/tests/captureQualityYF2.test.js
//
// Y-F2 — La foto se evalúa y se normaliza antes de gastar una llamada al proveedor.
//   * una foto oscura, desenfocada o pequeña se rechaza con motivo medido,
//   * la aceptada se normaliza a 512×512 JPEG,
//   * el subtono se mide sobre los píxeles de piel (ITA° + ángulo de tono) y no se
//     hereda del tipo de piel,
//   * si la captura se rechaza, el orquestador NO llama a YouCam.

const sharp = require('sharp');

// Los proveedores se aíslan: la prueba mide que NO se llamen cuando la foto no sirve.
jest.mock('../services/biometric/youcam.client', () => ({ analyzeFace: jest.fn() }));
jest.mock('../services/biometric/gemini.client', () => ({
  analyzeHands: jest.fn(),
  generateRecommendation: jest.fn(),
}));
jest.mock('../services/biometric/deepseek.client', () => ({
  generateRecommendation: jest.fn(),
  getVtoToneMatching: jest.fn(),
}));

const captureQuality = require('../services/biometric/captureQuality.service');
const undertone = require('../services/biometric/undertone.service');

/** Imagen con tablero de alto contraste: luminancia media ≈ 127 y nitidez alta. */
async function checkerboard(width, height, dark = 0, light = 255, cell = 8) {
  const channels = 3;
  const raw = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0 ? dark : light;
      const idx = (y * width + x) * channels;
      raw[idx] = value;
      raw[idx + 1] = value;
      raw[idx + 2] = value;
    }
  }
  return sharp(raw, { raw: { width, height, channels } }).png().toBuffer();
}

/** Imagen plana de un color: nitidez ≈ 0. */
async function flat(width, height, rgb) {
  return sharp({ create: { width, height, channels: 3, background: rgb } }).png().toBuffer();
}

describe('Y-F2 — calidad de captura', () => {
  test('una foto nítida y bien expuesta se acepta y se normaliza a 512×512', async () => {
    const buffer = await checkerboard(1200, 1600);

    const prepared = await captureQuality.prepareFace(buffer);

    expect(prepared.rejected).toBe(false);
    expect(prepared.quality.verdict).toBe('ACEPTADA');
    expect(prepared.image.width).toBe(512);
    expect(prepared.image.height).toBe(512);
    expect(prepared.image.bytes).toBeGreaterThan(0);
    expect(prepared.geometry.normalization).toBe('cover-centre-512');
    expect(prepared.geometry.sourceWidth).toBe(1200);
    expect(prepared.geometry.sourceHeight).toBe(1600);

    // El buffer normalizado es un JPEG decodificable
    const meta = await sharp(prepared.image.buffer).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(512);
  });

  test('una foto oscura se rechaza por subexposición', async () => {
    const buffer = await checkerboard(1200, 1600, 10, 30);

    const prepared = await captureQuality.prepareFace(buffer);

    expect(prepared.rejected).toBe(true);
    expect(prepared.quality.verdict).toBe('RECHAZADA');
    expect(prepared.quality.reasons.map((r) => r.code)).toContain('SUBEXPUESTA');
    expect(prepared.quality.metrics.luminance).toBeLessThan(captureQuality.LUMINANCE_MIN);
    // Sin normalizar: no se preparó nada para enviar
    expect(prepared.image).toBeNull();
  });

  test('una foto desenfocada se rechaza por nitidez', async () => {
    const buffer = await flat(1200, 1600, { r: 130, g: 130, b: 130 });

    const prepared = await captureQuality.prepareFace(buffer);

    expect(prepared.rejected).toBe(true);
    expect(prepared.quality.reasons.map((r) => r.code)).toContain('DESENFOCADA');
    expect(prepared.quality.metrics.sharpness).toBeLessThan(captureQuality.SHARPNESS_MIN);
  });

  test('una foto pequeña se rechaza por resolución', async () => {
    const buffer = await checkerboard(300, 300);

    const quality = await captureQuality.assessQuality(buffer);

    expect(quality.verdict).toBe('RECHAZADA');
    expect(quality.reasons.map((r) => r.code)).toContain('RESOLUCION_BAJA');
    expect(quality.reasons.find((r) => r.code === 'RESOLUCION_BAJA').metric).toBe('300x300');
  });

  test('una imagen ilegible no se envía', async () => {
    const prepared = await captureQuality.prepareFace(Buffer.from('esto no es una imagen'));

    expect(prepared.rejected).toBe(true);
    expect(prepared.quality.reasons[0].code).toBe('IMAGEN_ILEGIBLE');
  });
});

describe('Y-F2 — subtono medido', () => {
  test('tono cálido: dominancia de amarillo clasifica cálido', async () => {
    const buffer = await flat(800, 800, { r: 224, g: 172, b: 138 });

    const result = await undertone.measureUndertone(buffer);

    expect(result.measured).toBe(true);
    expect(result.subtono).toBe('cálido');
    expect(result.lab.b).toBeGreaterThanOrEqual(16.5);
    expect(result.ita).toBeGreaterThan(28);
    expect(result.samplePixels).toBeGreaterThan(undertone.MIN_SKIN_PIXELS);
    expect(result.method).toBe('ita-hue-propio');
  });

  test('tono frío: poco amarillo clasifica frío', async () => {
    const buffer = await flat(800, 800, { r: 214, g: 178, b: 178 });

    const result = await undertone.measureUndertone(buffer);

    expect(result.measured).toBe(true);
    expect(result.subtono).toBe('frío');
    expect(result.lab.b).toBeLessThanOrEqual(11.5);
  });

  test('sin píxeles de piel no se afirma subtono', async () => {
    // Gris puro: Cb = 128, fuera del rango de piel (77–127).
    const buffer = await flat(800, 800, { r: 128, g: 128, b: 128 });

    const result = await undertone.measureUndertone(buffer);

    expect(result.measured).toBe(false);
    expect(result.subtono).toBeNull();
    expect(result.reason).toMatch(/px de piel/);
  });

  test('clasificación por umbrales declarados', () => {
    expect(undertone.classifyUndertone(20, 60)).toBe('cálido');
    expect(undertone.classifyUndertone(10, 40)).toBe('frío');
    expect(undertone.classifyUndertone(14, 55)).toBe('neutro');
  });

  test('ITA° y su etiqueta', () => {
    expect(Math.round(undertone.individualTypologyAngle(65, 18))).toBe(40);
    expect(undertone.itaLabel(60)).toBe('muy clara');
    expect(undertone.itaLabel(35)).toBe('intermedia');
    expect(undertone.itaLabel(5)).toBe('oscura');
    expect(undertone.itaLabel(null)).toBeNull();
  });
});

describe('Y-F2 — el orquestador no gasta unidades con una foto inservible', () => {
  const youcam = require('../services/biometric/youcam.client');
  const gemini = require('../services/biometric/gemini.client');
  const deepseek = require('../services/biometric/deepseek.client');
  const orchestrator = require('../services/biometric/orchestrator');

  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('foto oscura: 422 con motivo y cero llamadas al proveedor', async () => {
    const buffer = await checkerboard(1200, 1600, 10, 30);

    await expect(orchestrator.analyze(7, buffer, null, 'ideas'))
      .rejects.toMatchObject({ code: 'CAPTURE_REJECTED', statusCode: 422 });

    expect(youcam.analyzeFace).not.toHaveBeenCalled();
    expect(gemini.analyzeHands).not.toHaveBeenCalled();
    expect(deepseek.generateRecommendation).not.toHaveBeenCalled();
  });
});

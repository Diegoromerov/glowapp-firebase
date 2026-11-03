// backend/src/services/biometric/undertone.service.js
//
// Y-F2 — Subtono medido, no heredado del tipo de piel.
//
// Hasta Y-F1 el campo `subtono` se llenaba con `hd_skin_type` de YouCam, que devuelve
// "Oily/Dry/Normal/Combination": eso es el TIPO de piel, no el subtono. La app lo
// consumía como si fuera subtono, así que el selector de tonos VTO y el color de la
// ficha nunca acertaban (el switch de Flutter espera 'cálido'/'frío'/'neutro' y
// recibía 'Oily', cayendo siempre en el valor por defecto).
//
// Aquí se mide sobre los píxeles de piel de la propia foto:
//   1. recorte central (60% del lado menor): es donde está la mejilla, no el fondo,
//   2. filtro de piel en YCbCr (Cb 77–127, Cr 133–173) — descarta ojos, pelo y pared,
//   3. sRGB → CIE Lab (D65),
//   4. ITA° (ángulo de tipología individual) y ángulo de tono h = atan2(b*, a*),
//   5. clasificación cálido / frío / neutro por dominancia de b* (amarillo) y h.
//
// Límites declarados: es una medición de color, no un diagnóstico. Con menos de
// 500 px de piel no se afirma nada (`measured: false`), y el subtono queda pendiente
// en vez de inventarse.

const sharp = require('sharp');
const logger = require('../../config/logger');

const CROP_RATIO = 0.6;
const MIN_SKIN_PIXELS = 500;

// Umbrales de clasificación (declarados, no ajustados a un caso concreto).
const WARM_B_STAR = 16.5;
const COOL_B_STAR = 11.5;
const WARM_HUE = 50;

/** sRGB (0–255) → CIE Lab D65. */
function srgbToLab(r, g, b) {
  const toLinear = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const R = toLinear(r);
  const G = toLinear(g);
  const B = toLinear(b);

  const X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const Y = (R * 0.2126729 + G * 0.7151522 + B * 0.0721750) / 1.00000;
  const Z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / 1.08883;

  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : (7.787 * t) + (16 / 116));
  const fx = f(X);
  const fy = f(Y);
  const fz = f(Z);

  return {
    L: (116 * fy) - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

/** Filtro de piel en YCbCr (rango clásico para tonos de piel en luz visible). */
function isSkinPixel(r, g, b) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - (0.168736 * r) - (0.331264 * g) + (0.5 * b);
  const cr = 128 + (0.5 * r) - (0.418688 * g) - (0.081312 * b);
  return y > 40 && cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
}

/** Clasifica por dominancia de amarillo y ángulo de tono. */
function classifyUndertone(bStar, hueAngle) {
  if (bStar >= WARM_B_STAR && hueAngle >= WARM_HUE) return 'cálido';
  if (bStar <= COOL_B_STAR) return 'frío';
  return 'neutro';
}

/** ITA° según Chardon et al. (1991): ángulo de tipología individual. */
function individualTypologyAngle(L, bStar) {
  if (bStar === 0) return null;
  return (Math.atan((L - 50) / bStar) * 180) / Math.PI;
}

function itaLabel(ita) {
  if (ita === null) return null;
  if (ita > 55) return 'muy clara';
  if (ita > 41) return 'clara';
  if (ita > 28) return 'intermedia';
  if (ita > 10) return 'trigueña';
  return 'oscura';
}

/**
 * Mide el subtono sobre el recorte central de la foto.
 * @param {Buffer} buffer - Imagen facial (idealmente ya normalizada a 512×512)
 * @returns {Promise<{measured:boolean, subtono:string|null, ita:number|null, hueAngle:number|null, samplePixels:number, method:string, reason?:string}>}
 */
async function measureUndertone(buffer) {
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  if (!width || !height) {
    return { measured: false, subtono: null, ita: null, hueAngle: null, samplePixels: 0, method: 'ita-hue-propio', reason: 'imagen sin dimensiones' };
  }

  const side = Math.round(Math.min(width, height) * CROP_RATIO);
  const left = Math.max(0, Math.round((width - side) / 2));
  const top = Math.max(0, Math.round((height - side) / 2));

  const { data, info } = await sharp(buffer)
    .extract({ left, top, width: Math.min(side, width), height: Math.min(side, height) })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  let count = 0;
  let sumL = 0;
  let sumA = 0;
  let sumB = 0;

  for (let i = 0; i + channels - 1 < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (!isSkinPixel(r, g, b)) continue;
    const lab = srgbToLab(r, g, b);
    sumL += lab.L;
    sumA += lab.a;
    sumB += lab.b;
    count += 1;
  }

  const samplePixels = count;
  if (count < MIN_SKIN_PIXELS) {
    logger.warn('Subtono no medido: pocos píxeles de piel', { samplePixels, minRequired: MIN_SKIN_PIXELS });
    return {
      measured: false,
      subtono: null,
      ita: null,
      hueAngle: null,
      samplePixels,
      method: 'ita-hue-propio',
      reason: `solo ${count} px de piel (mínimo ${MIN_SKIN_PIXELS})`,
    };
  }

  const L = sumL / count;
  const a = sumA / count;
  const b = sumB / count;
  const hueAngle = (Math.atan2(b, a) * 180) / Math.PI;
  const ita = individualTypologyAngle(L, b);
  const subtono = classifyUndertone(b, hueAngle);

  return {
    measured: true,
    subtono,
    ita: ita === null ? null : Math.round(ita * 10) / 10,
    itaLabel: itaLabel(ita),
    hueAngle: Math.round(hueAngle * 10) / 10,
    lab: { L: Math.round(L * 10) / 10, a: Math.round(a * 10) / 10, b: Math.round(b * 10) / 10 },
    samplePixels,
    method: 'ita-hue-propio',
  };
}

module.exports = {
  measureUndertone,
  classifyUndertone,
  srgbToLab,
  isSkinPixel,
  individualTypologyAngle,
  itaLabel,
  MIN_SKIN_PIXELS,
};

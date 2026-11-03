// backend/src/services/biometric/captureQuality.service.js
//
// Y-F2 — Puerta de calidad y normalización de la foto facial antes de pagar una
// llamada a YouCam.
//
// Problema que resuelve: el orquestador enviaba el buffer tal como llegaba del
// celular. Una foto oscura, borrosa o de 300 px se analizaba igual, se cobraban las
// unidades y las métricas resultantes no eran comparables con las de la semana
// anterior (el test-retest que promete Perfect Corp. supone captura estándar). Aquí
// se rechaza lo inservible ANTES de gastar unidades, y lo aceptable se normaliza a
// 512×512 JPEG, que es el tamaño de trabajo del proveedor.
//
// Los umbrales son heurísticas declaradas, no una promesa de precisión clínica:
//   * lado mínimo 640 px — por debajo no hay píxeles suficientes para poros/textura.
//   * luminancia media 45–225 — fuera de ahí la piel queda sub o sobreexpuesta.
//   * nitidez (varianza del laplaciano) >= 8 — por debajo la imagen está desenfocada.
// Cada rechazo devuelve el motivo concreto y la métrica que lo disparó.

const sharp = require('sharp');
const logger = require('../../config/logger');

const TARGET_SIZE = 512;
const MIN_SIDE = 640;
const LUMINANCE_MIN = 45;
const LUMINANCE_MAX = 225;
const LUMINANCE_WARN = 70;
const SHARPNESS_MIN = 8;
const SHARPNESS_WARN = 20;

/** Estadísticas de luminancia y nitidez sobre la imagen (gris, escalada a 512). */
async function measurePixels(buffer) {
  const { data, info } = await sharp(buffer)
    .greyscale()
    .resize(TARGET_SIZE, TARGET_SIZE, { fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const total = width * height;
  let sum = 0;
  for (let i = 0; i < total; i += 1) sum += data[i];
  const mean = sum / total;

  let variance = 0;
  for (let i = 0; i < total; i += 1) {
    const diff = data[i] - mean;
    variance += diff * diff;
  }
  variance /= total;

  // Varianza del laplaciano 4-vecinos: nitidez relativa, no absoluta.
  let lapSum = 0;
  let lapSqSum = 0;
  let lapCount = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      const lap = 4 * data[idx] - data[idx - 1] - data[idx + 1] - data[idx - width] - data[idx + width];
      lapSum += lap;
      lapSqSum += lap * lap;
      lapCount += 1;
    }
  }
  const lapMean = lapCount > 0 ? lapSum / lapCount : 0;
  const sharpness = lapCount > 0 ? (lapSqSum / lapCount) - (lapMean * lapMean) : 0;

  return {
    luminance: Math.round(mean * 10) / 10,
    contrast: Math.round(Math.sqrt(variance) * 10) / 10,
    sharpness: Math.round(sharpness * 10) / 10,
  };
}

/**
 * Evalúa si la foto sirve para medir piel.
 * @returns {{verdict:'ACEPTADA'|'REVISAR'|'RECHAZADA', score:number, reasons:Array, metrics:Object}}
 */
async function assessQuality(buffer) {
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  const reasons = [];

  if (width < MIN_SIDE || height < MIN_SIDE) {
    reasons.push({
      code: 'RESOLUCION_BAJA',
      severity: 'RECHAZO',
      metric: `${width}x${height}`,
      message: `La foto debe tener al menos ${MIN_SIDE} px por lado (recibida ${width}x${height}).`,
    });
  }

  const pixels = await measurePixels(buffer);

  if (pixels.luminance < LUMINANCE_MIN) {
    reasons.push({
      code: 'SUBEXPUESTA',
      severity: 'RECHAZO',
      metric: pixels.luminance,
      message: `Imagen demasiado oscura (luminancia ${pixels.luminance}); se necesita al menos ${LUMINANCE_MIN}.`,
    });
  } else if (pixels.luminance < LUMINANCE_WARN) {
    reasons.push({
      code: 'LUZ_BAJA',
      severity: 'AVISO',
      metric: pixels.luminance,
      message: `Iluminación baja (luminancia ${pixels.luminance}); la medición pierde precisión.`,
    });
  } else if (pixels.luminance > LUMINANCE_MAX) {
    reasons.push({
      code: 'SOBREEXPUESTA',
      severity: 'RECHAZO',
      metric: pixels.luminance,
      message: `Imagen sobreexpuesta (luminancia ${pixels.luminance}); se permite hasta ${LUMINANCE_MAX}.`,
    });
  }

  if (pixels.sharpness < SHARPNESS_MIN) {
    reasons.push({
      code: 'DESENFOCADA',
      severity: 'RECHAZO',
      metric: pixels.sharpness,
      message: `Imagen desenfocada (nitidez ${pixels.sharpness}); se necesita al menos ${SHARPNESS_MIN}.`,
    });
  } else if (pixels.sharpness < SHARPNESS_WARN) {
    reasons.push({
      code: 'NITIDEZ_BAJA',
      severity: 'AVISO',
      metric: pixels.sharpness,
      message: `Nitidez justa (${pixels.sharpness}); conviene repetir la captura.`,
    });
  }

  const rechazos = reasons.filter((r) => r.severity === 'RECHAZO').length;
  const avisos = reasons.filter((r) => r.severity === 'AVISO').length;
  const verdict = rechazos > 0 ? 'RECHAZADA' : (avisos > 0 ? 'REVISAR' : 'ACEPTADA');
  const score = Math.max(0, 100 - rechazos * 45 - avisos * 15);

  return {
    verdict,
    score,
    reasons,
    metrics: { ...pixels, width, height },
  };
}

/**
 * Normaliza la foto al marco de trabajo del proveedor: EXIF aplicado, recorte
 * cuadrado centrado y JPEG 512×512. Se usa `position: 'centre'` y no 'attention'
 * porque el detector de saliencia puede recortar la frente o el mentón y cambiar
 * las métricas por subregión.
 */
async function normalizeFace(buffer) {
  const source = await sharp(buffer).metadata();

  const { data, info } = await sharp(buffer)
    .rotate()
    .resize(TARGET_SIZE, TARGET_SIZE, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    width: info.width,
    height: info.height,
    bytes: info.size,
    sourceWidth: source.width || null,
    sourceHeight: source.height || null,
    orientation: source.orientation || null,
    normalized: true,
  };
}

/**
 * Flujo completo antes del proveedor: medir, decidir y normalizar.
 * Si la foto se rechaza devuelve `rejected: true` y no gasta nada.
 */
async function prepareFace(buffer) {
  let quality;
  try {
    quality = await assessQuality(buffer);
  } catch (error) {
    logger.warn('No se pudo evaluar la calidad de la captura', { error: error.message });
    // Si el formato no se puede leer, no se envía: el proveedor fallaría igual.
    return {
      rejected: true,
      quality: {
        verdict: 'RECHAZADA',
        score: 0,
        reasons: [{ code: 'IMAGEN_ILEGIBLE', severity: 'RECHAZO', metric: null, message: 'No se pudo decodificar la imagen.' }],
        metrics: {},
      },
      geometry: null,
      image: null,
    };
  }

  if (quality.verdict === 'RECHAZADA') {
    return { rejected: true, quality, geometry: null, image: null };
  }

  const image = await normalizeFace(buffer);
  const geometry = {
    sourceWidth: image.sourceWidth,
    sourceHeight: image.sourceHeight,
    exifOrientation: image.orientation,
    normalizedWidth: image.width,
    normalizedHeight: image.height,
    normalizedBytes: image.bytes,
    normalization: 'cover-centre-512',
  };

  return { rejected: false, quality, geometry, image };
}

module.exports = {
  TARGET_SIZE,
  MIN_SIDE,
  LUMINANCE_MIN,
  LUMINANCE_MAX,
  SHARPNESS_MIN,
  assessQuality,
  normalizeFace,
  prepareFace,
  measurePixels,
};

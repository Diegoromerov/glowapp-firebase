// backend/src/services/biometric/imageHash.service.js
//
// Y-F5: huella de la foto facial para no pagar dos veces el mismo análisis.
//
// Dos niveles, a propósito:
//   * HMAC-SHA256 con pepper del servidor -> la misma imagen normalizada. Barato, exacto
//     y sin dejar un identificador que permita confirmar a quién pertenece una foto.
//   * dHash de 64 bits (9x8 gris)  -> la misma foto re-codificada o recomprimida.
//     Compara con distancia de Hamming: <= 6 bits distintos de 64 (~9%) se considera
//     la misma foto. Por encima de eso son fotos distintas, no variaciones de encoding.
//
// El dHash es un descriptor biométrico derivado: NO se persiste en claro (ADR-001).
// Viaja dentro del payload cifrado de la sesión y se compara descifrando las últimas
// sesiones del usuario. Solo el HMAC con pepper se guarda en la columna indexada.

const crypto = require('crypto');
const sharp = require('sharp');

const DHASH_WIDTH = 9;   // 9 columnas -> 8 comparaciones horizontales
const DHASH_HEIGHT = 8;  // 8 filas -> 64 bits
const DEFAULT_HAMMING_THRESHOLD = 6;

/**
 * Pepper para el hash exacto. Si no hay clave dedicada se usa la de cifrado biométrico:
 * rotarla invalida la caché exacta (cae al dHash), que es un fallo seguro.
 */
function getPepper() {
  return process.env.BIOMETRIC_HASH_PEPPER || process.env.BIOMETRIC_ENCRYPTION_KEY || null;
}

/** Convierte una cadena de 64 bits en 16 caracteres hex (4 bits por carácter). */
function bitsToHex(bits) {
  let hex = '';
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

/** Distancia de Hamming entre dos hashes hex de 64 bits. Null si no son comparables. */
function hammingDistance(hexA, hexB) {
  if (typeof hexA !== 'string' || typeof hexB !== 'string') return null;
  if (!/^[0-9a-f]{16}$/i.test(hexA) || !/^[0-9a-f]{16}$/i.test(hexB)) return null;

  let distance = 0;
  for (let i = 0; i < 16; i += 1) {
    const xor = parseInt(hexA[i], 16) ^ parseInt(hexB[i], 16);
    // Conteo de bits encendidos en un nibble (0-15)
    distance += [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4][xor];
  }
  return distance;
}

/**
 * Huella de una imagen: `hmac` (identificador con pepper, apto para índice) y `dhash`
 * (descriptor, va cifrado). Si la imagen no se puede leer devuelve null en el campo
 * afectado: el escaneo sigue adelante sin caché en vez de fallar por el hashing.
 */
async function fingerprint(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { hmac: null, dhash: null };
  }

  const pepper = getPepper();
  const hmac = pepper
    ? crypto.createHmac('sha256', pepper).update(buffer).digest('hex')
    : null;

  try {
    const { data } = await sharp(buffer)
      .greyscale()
      .resize(DHASH_WIDTH, DHASH_HEIGHT, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    let bits = '';
    for (let y = 0; y < DHASH_HEIGHT; y += 1) {
      for (let x = 0; x < DHASH_WIDTH - 1; x += 1) {
        const left = data[y * DHASH_WIDTH + x];
        const right = data[y * DHASH_WIDTH + x + 1];
        bits += left > right ? '1' : '0';
      }
    }

    return { hmac, dhash: bitsToHex(bits) };
  } catch (error) {
    return { hmac, dhash: null, error: error.message };
  }
}

/**
 * ¿La huella `a` corresponde a la misma foto que `b`?
 * Devuelve { same, reason, distance } para poder auditar por qué se reutilizó.
 */
function isSamePhoto(a, b, threshold = DEFAULT_HAMMING_THRESHOLD) {
  if (!a || !b) return { same: false, reason: 'sin_huella', distance: null };

  if (a.hmac && b.hmac && a.hmac === b.hmac) {
    return { same: true, reason: 'hash_exacto', distance: 0 };
  }

  const distance = hammingDistance(a.dhash, b.dhash);
  if (distance === null) return { same: false, reason: 'sin_huella_perceptual', distance: null };

  return {
    same: distance <= threshold,
    reason: distance <= threshold ? 'perceptual' : 'distinta',
    distance,
  };
}

module.exports = {
  fingerprint,
  isSamePhoto,
  hammingDistance,
  getPepper,
  DEFAULT_HAMMING_THRESHOLD,
};

'use strict';

const MAX_FILES = 5;
const MAX_FILE_BYTES = 1500000;
const MAX_TOTAL_BYTES = 7500000;

function validarEvidencias(value) {
  if (value === undefined || value === null) return { ok: true, evidence: [] };
  if (!Array.isArray(value) || value.length > MAX_FILES) {
    return { ok: false, status: 400, message: 'Adjunta máximo 5 imágenes.' };
  }
  let total = 0;
  for (const item of value) {
    const match = typeof item === 'string'
      && item.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) return { ok: false, status: 400, message: 'Usa imágenes JPEG, PNG o WebP.' };
    const payload = match[2];
    const bytes = Buffer.from(payload, 'base64').length;
    // Buffer is permissive with malformed base64; round-trip check rejects junk.
    if (Buffer.from(payload, 'base64').toString('base64').replace(/=+$/, '') !== payload.replace(/=+$/, '')) {
      return { ok: false, status: 400, message: 'Una evidencia no tiene una codificación válida.' };
    }
    if (bytes > MAX_FILE_BYTES) return { ok: false, status: 413, message: 'Cada imagen debe pesar máximo 1,5 MB.' };
    total += bytes;
    if (total > MAX_TOTAL_BYTES) return { ok: false, status: 413, message: 'El tamaño total no puede superar 7,5 MB.' };
  }
  return { ok: true, evidence: value };
}

module.exports = { validarEvidencias, MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES };

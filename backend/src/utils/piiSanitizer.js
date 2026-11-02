/**
 * backend/src/utils/piiSanitizer.js
 * Utilidad desacoplada para sanitización de PII en logs
 * Principio: Single Responsibility - solo sanitización, sin lógica de negocio
 */

const crypto = require('crypto');

/**
 * Sanitiza texto para logging - elimina PII y datos biométricos sensibles
 * @param {string|undefined|null} text - Texto a sanitizar
 * @returns {string} Texto sanitizado y truncado a 500 chars máximo
 */
function sanitizeForLog(text) {
  if (!text || typeof text !== 'string') {
    return '[EMPTY]';
  }

  let sanitized = text;

  // 1. Redactar emails
  sanitized = sanitized.replace(
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    '[EMAIL_REDACTED]'
  );

  // 2. Redactar teléfonos Colombia (+57, formatos con/sin guiones/espacios)
  sanitized = sanitized.replace(
    /\b(?:\+57\s*)?(?:3\d{2}|[1-8]\d{1})[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
    '[TELEFONO_REDACTED]'
  );

  // 3. Redactar direcciones IP (IPv4)
  sanitized = sanitized.replace(
    /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    '[IP_REDACTED]'
  );

  // 4. Redactar edades explícitas ("45 años", "30 yrs", "tengo 25")
  sanitized = sanitized.replace(
    /\b(?:tengo\s+)?\d{1,2}\s*(?:años?|yrs?)\b/gi,
    '[EDAD_REDACTED]'
  );

  // 5. Redactar coordenadas GPS precisas (más de 4 decimales)
  sanitized = sanitized.replace(
    /\b-?\d{1,2}\.\d{5,}\s*[,;]\s*-?\d{1,3}\.\d{5,}\b/g,
    '[COORDS_REDACTED]'
  );

  // 6. Truncar a 500 caracteres máximo para logs
  const MAX_LOG_LENGTH = 500;
  if (sanitized.length > MAX_LOG_LENGTH) {
    sanitized = sanitized.slice(0, MAX_LOG_LENGTH) + '...[TRUNCATED]';
  }

  return sanitized;
}

/**
 * Hash determinístico para IDs en logs (no reversible)
 * @param {string|number} id - ID a hashear
 * @returns {string} Hash truncado
 */
function hashIdForLog(id) {
  if (!id && id !== 0) return '[NO_ID]';
  return crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 8);
}

module.exports = {
  sanitizeForLog,
  hashIdForLog,
};
const crypto = require('crypto');

const MIN_SECRET_LENGTH = 32;
let memoizedDevSecret = null;

/**
 * Obtiene el secreto JWT para firmado y verificación.
 * 1. Si process.env.NODE_ENV es 'production' o 'staging', exige JWT_SECRET >= 32 caracteres (Fail-Fast sin secreto por defecto).
 * 2. Si JWT_SECRET está presente en env y cumple la longitud >= 32, se utiliza.
 * 3. En entorno dev/test sin JWT_SECRET (o si mide < 32), emite console.warn y genera un secreto efímero aleatorio en memoria mediante crypto.randomBytes(32).
 */
const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  const env = (process.env.NODE_ENV || 'development').toLowerCase();
  const isStrictEnv = env === 'production' || env === 'staging';

  if (isStrictEnv) {
    if (!secret || secret.trim().length < MIN_SECRET_LENGTH) {
      throw new Error(
        `[FATAL SECURITY ERROR] La variable de entorno JWT_SECRET es obligatoria y debe tener al menos ${MIN_SECRET_LENGTH} caracteres en entorno '${env}'.`
      );
    }
    return secret.trim();
  }

  // En dev/test, si se proporciona JWT_SECRET en env y cumple la longitud >= 32
  if (secret && secret.trim().length >= MIN_SECRET_LENGTH) {
    return secret.trim();
  }

  // Fuera de producción, si JWT_SECRET existe pero mide < 32 caracteres, emitir console.warn explícito
  if (secret && secret.trim().length > 0 && secret.trim().length < MIN_SECRET_LENGTH) {
    console.warn(
      `⚠️ [JWT WARNING] JWT_SECRET en entorno '${env}' mide ${secret.trim().length} caracteres (mínimo recomendado: ${MIN_SECRET_LENGTH}). Se utilizará un secreto efímero aleatorio en memoria.`
    );
  }

  // En dev/test sin JWT_SECRET en env: generar secreto efímero aleatorio en memoria (no hardcodeado en repo)
  if (!memoizedDevSecret) {
    memoizedDevSecret = crypto.randomBytes(32).toString('hex');
  }
  return memoizedDevSecret;
};

const toApiRole = (dbRole) => {
  if (dbRole === 'PRESTADOR') return 'provider';
  if (dbRole === 'CLIENTE') return 'client';
  if (dbRole === 'SALON') return 'salon';
  if (dbRole === 'ADMIN') return 'admin';
  return null;
};

module.exports = { getJwtSecret, toApiRole, MIN_SECRET_LENGTH };

const crypto = require('crypto');
const { getJwtSecret } = require('../config/jwt');

const ALGORITHM = 'aes-256-gcm';

/** Entornos donde NO se admite ninguna derivación de conveniencia. */
const esEntornoProductivo = () =>
  process.env.NODE_ENV === 'production' ||
  process.env.NODE_ENV === 'staging' ||
  !!process.env.RAILWAY_ENVIRONMENT;

/**
 * Clave LEGADA (anterior a C-11): se derivaba de JWT_SECRET. Solo existe para poder
 * descifrar y re-cifrar los datos que ya están en la base con ella.
 * Ver backend/scripts/reencryptBiometricData.js
 */
const CLAVE_LEGADA = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET requerida para derivar CLAVE_LEGADA');
  }
  return crypto.createHash('sha256').update(secret).digest();
};

let activeCipherBuffer;

function initializeKey() {
  // La clave biométrica puede venir de su propia variable o, transitoriamente, de
  // ENCRYPTION_KEY (que ya existe en producción). Lo que NO puede es derivarse del
  // JWT_SECRET: con un solo secreto comprometido caían sesiones Y biometría
  // (A360-2026-09-22/C-11).
  const keyEnv = process.env.BIOMETRIC_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY;
  if (!keyEnv || typeof keyEnv !== 'string') {
    if (esEntornoProductivo()) {
      throw new Error(
        'CRITICAL SECURITY ERROR: BIOMETRIC_ENCRYPTION_KEY no está configurada. ' +
        'El cifrado de datos biométricos no puede derivar del JWT_SECRET. ' +
        'Provisiona la clave (o ENCRYPTION_KEY) antes de arrancar; ver scripts/reencryptBiometricData.js.'
      );
    }
    console.warn('⚠️  [SECURITY WARNING] BIOMETRIC_ENCRYPTION_KEY desconfigurada — usando derivación solo para dev local.');
    const baseSecret = getJwtSecret();
    activeCipherBuffer = crypto.createHash('sha256').update(baseSecret).digest();
    return;
  }

  // Key must be 32 bytes for AES-256 (supports 64-char hex or 32-char utf8)
  let keyBuffer;
  if (/^[0-9a-fA-F]{64}$/.test(keyEnv.trim())) {
    keyBuffer = Buffer.from(keyEnv.trim(), 'hex');
  } else if (Buffer.byteLength(keyEnv, 'utf8') === 32) {
    keyBuffer = Buffer.from(keyEnv, 'utf8');
  } else {
    // DECISION 2026-10-09 (Diego): fail-CLOSED en todos los entornos.
    // Antes, fuera de test la clave mal formada se hasheaba y se ACEPTABA en silencio: una
    // clave de cifrado invalida degradaba a un hash en vez de impedir el arranque. Eso es
    // fail-open, lo contrario de isStrictEnvironment() en config/db.js y del endurecimiento
    // T-A0. Una clave mal formada no se arregla sola: se rechaza.
    throw new Error('La clave biométrica debe ser de 32 bytes');
  }

  if (keyBuffer.length !== 32) {
    throw new Error('La clave biométrica debe ser de 32 bytes');
  }
  activeCipherBuffer = keyBuffer;
}

// Initialize on module load
initializeKey();

class BiometricCryptoService {
  encrypt(data) {
    if (!data) return null;
    const text = typeof data === 'object' ? JSON.stringify(data) : String(data);

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, activeCipherBuffer, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');

    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  decrypt(encryptedString) {
    if (!encryptedString) {
      return null;
    }
    // TODO (B-01): Limpieza de filas legadas no cifradas. Una vez ejecutada la migración/re-cifrado, rechazar objetos planos en claro.
    if (typeof encryptedString === 'object') {
      console.warn('⚠️ [BIOMETRIC_DECRYPT_PLAIN_FALLBACK] Se recibió un objeto/array en claro sin cifrar. Retornando objeto plano.');
      return encryptedString;
    }
    if (typeof encryptedString !== 'string') {
      return null;
    }
    // Si viene como una cadena JSON en claro (filas antiguas sin cifrar)
    if (encryptedString.startsWith('{') || encryptedString.startsWith('[')) {
      try {
        const plainObj = JSON.parse(encryptedString);
        console.warn('⚠️ [BIOMETRIC_DECRYPT_PLAIN_FALLBACK] Se recibió JSON string en claro sin cifrar. Retornando objeto plano.');
        return plainObj;
      } catch (_) {}
    }
    const parts = encryptedString.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid ciphertext format');
    }
    const [ivHex, authTagHex, encryptedText] = parts;

    // Validación explícita antes de tocar crypto. `Buffer.from(str, 'hex')` NO
    // rechaza un carácter inválido: lo descarta y devuelve un buffer más corto,
    // así que un authTag corrupto se convertía en uno de 15 bytes y `final()`
    // podía no lanzar. El resultado dependía de la versión de Node; con Node 22 el
    // caso "invalid hex in authTag" dejaba de fallar. GCM exige 16 bytes exactos.
    const HEX = /^[0-9a-fA-F]+$/;
    if (!HEX.test(ivHex) || ivHex.length !== 24) {
      throw new Error('Invalid IV');
    }
    if (!HEX.test(authTagHex)) {
      throw new Error('Invalid authentication tag');
    }
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    if (authTag.length !== 16) {
      throw new Error('Invalid authentication tag length');
    }
    const decipher = crypto.createDecipheriv(ALGORITHM, activeCipherBuffer, iv);
    decipher.setAuthTag(authTag);

    let decrypted;
    try {
      decrypted = decipher.update(encryptedText, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
    } catch (err) {
      throw new Error('Decryption failed');
    }

    try {
      return JSON.parse(decrypted);
    } catch (_) {
      return decrypted;
    }
  }

  /**
   * Descifra con la clave LEGADA (la que se derivaba de JWT_SECRET). Existe solo para
   * migrar los datos ya cifrados con ella antes de cambiar el origen de la clave.
   * Uso: backend/scripts/reencryptBiometricData.js (A360-2026-09-22/C-11).
   */
  decryptWithLegacyKey(encryptedString) {
    if (!encryptedString || typeof encryptedString !== 'string') return null;
    const parts = encryptedString.split(':');
    if (parts.length !== 3) throw new Error('Invalid ciphertext format');
    const [ivHex, authTagHex, encryptedText] = parts;
    const decipher = crypto.createDecipheriv(ALGORITHM, CLAVE_LEGADA(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    try {
      return JSON.parse(decrypted);
    } catch (_) {
      return decrypted;
    }
  }

  /** Huella de la clave activa: sirve para auditar con cuál se cifró cada registro. */
  keyFingerprint() {
    return crypto.createHash('sha256').update(activeCipherBuffer).digest('hex').slice(0, 8);
  }
}

module.exports = new BiometricCryptoService();
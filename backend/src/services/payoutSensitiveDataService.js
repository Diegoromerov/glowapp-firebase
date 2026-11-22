const crypto = require('crypto');

const PREFIX = 'payout:v1:';
const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const configured = String(process.env.PAYOUT_DATA_ENCRYPTION_KEY || '').trim();
  if (!configured) throw new Error('PAYOUT_DATA_ENCRYPTION_KEY no está configurada.');
  if (/^[0-9a-fA-F]{64}$/.test(configured)) return Buffer.from(configured, 'hex');
  if (Buffer.byteLength(configured, 'utf8') === 32) return Buffer.from(configured, 'utf8');
  throw new Error('PAYOUT_DATA_ENCRYPTION_KEY debe tener exactamente 32 bytes o 64 caracteres hexadecimales.');
}

function encrypt(value) {
  if (value === null || value === undefined || value === '') return value ?? null;
  const text = String(value);
  if (text.startsWith(PREFIX)) return text;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ciphertext.toString('hex')}`;
}

function decrypt(value) {
  if (value === null || value === undefined || value === '') return value ?? null;
  const text = String(value);
  if (!text.startsWith(PREFIX)) return text; // Compatibilidad durante la migración de datos legados.
  const parts = text.slice(PREFIX.length).split(':');
  if (parts.length !== 3 || !/^[0-9a-f]{24}$/i.test(parts[0]) || !/^[0-9a-f]{32}$/i.test(parts[1]) || !/^(?:[0-9a-f]{2})*$/i.test(parts[2])) {
    throw new Error('Formato de dato de retiro cifrado inválido.');
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(parts[0], 'hex'));
  decipher.setAuthTag(Buffer.from(parts[1], 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(parts[2], 'hex')), decipher.final()]).toString('utf8');
}

function decryptWallet(row) {
  if (!row) return row;
  const result = { ...row };
  for (const field of ['numero_cuenta', 'titular_nombre', 'titular_documento_num', 'cuenta_anterior_numero', 'cuenta_anterior_titular_nombre', 'cuenta_anterior_documento_num']) {
    if (result[field] !== undefined) result[field] = decrypt(result[field]);
  }
  return result;
}

function fingerprint(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) throw new Error('No se puede calcular la huella de una cuenta vacía.');
  const fingerprintKey = crypto.createHmac('sha256', getKey())
    .update('glowapp:payout-account-fingerprint:v1')
    .digest();
  return crypto.createHmac('sha256', fingerprintKey).update(normalized).digest('hex');
}

module.exports = { PREFIX, encrypt, decrypt, decryptWallet, fingerprint };

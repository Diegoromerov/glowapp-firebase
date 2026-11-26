const crypto = require('crypto');

const PREFIX = 'v1';

function getKey(configured) {
  const value = String(configured || '').trim();
  if (!value) throw new Error('WOMPI_SAAS_ENCRYPTION_KEY es necesaria para proteger la fuente de pago.');
  return crypto.createHash('sha256')
    .update('glowapp:saas:wompi-payment-source:v1:', 'utf8')
    .update(value, 'utf8')
    .digest();
}

function activeKey() {
  const configured = String(process.env.WOMPI_SAAS_ENCRYPTION_KEY || '').trim();
  if (!configured) throw new Error('WOMPI_SAAS_ENCRYPTION_KEY es necesaria para guardar la fuente de pago SaaS.');
  return getKey(configured);
}

function encryptPaymentSourceId(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('El id de fuente de pago Wompi es obligatorio.');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', activeKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value.trim(), 'utf8'), cipher.final()]);
  return [PREFIX, iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
}

function decryptPaymentSourceId(payload) {
  const parts = String(payload || '').split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) throw new Error('Fuente de pago SaaS cifrada con formato no reconocido.');
  const [, iv, tag, ciphertext] = parts;
  const keys = [process.env.WOMPI_SAAS_ENCRYPTION_KEY,
    process.env.WOMPI_SAAS_ENCRYPTION_KEY_PREVIOUS].filter((value) => String(value || '').trim());
  for (const configured of keys) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(configured), Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
    } catch (_) { /* probar clave de rotación anterior */ }
  }
  throw new Error('No se pudo descifrar la fuente de pago; verifica las claves activas de facturación.');
}

module.exports = { encryptPaymentSourceId, decryptPaymentSourceId };

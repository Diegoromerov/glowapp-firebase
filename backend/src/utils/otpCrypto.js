// Cifrado del código OTP para poder mostrarlo en la app del cliente.
//
// El código se guarda hasheado (bcrypt) para verificarlo, y además cifrado
// (AES-256-GCM) para poder entregarlo sin depender de un correo con coste. El
// hash no se puede revertir; el cifrado sí, y solo con la clave del servidor.
const crypto = require('crypto');

function clave() {
  const raw = process.env.OTP_ENC_KEY || process.env.JWT_SECRET;
  if (!raw) {
    throw new Error('Falta OTP_ENC_KEY (o JWT_SECRET) para cifrar el código OTP.');
  }
  return crypto.createHash('sha256').update(String(raw)).digest();
}

/** Devuelve "iv.tag.ciphertext" en base64. */
function cifrar(texto) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', clave(), iv);
  const enc = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return [iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

function descifrar(payload) {
  const partes = String(payload || '').split('.');
  if (partes.length !== 3) throw new Error('Código OTP cifrado con formato inválido.');
  const [ivB64, tagB64, dataB64] = partes;
  const d = crypto.createDecipheriv('aes-256-gcm', clave(), Buffer.from(ivB64, 'base64'));
  d.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([d.update(Buffer.from(dataB64, 'base64')), d.final()]).toString('utf8');
}

module.exports = { cifrar, descifrar };

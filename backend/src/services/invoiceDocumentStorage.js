const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { GetObjectCommand, PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');

const MAGIC = Buffer.from('GAI1');
const KEY_CONTEXT = Buffer.from('glowapp:saas-invoice-document:v1');
const LOCAL_INVOICE_DIR = path.join(__dirname, '../../invoices');

let s3Client;

function isProduction() {
  return process.env.NODE_ENV === 'production' || Boolean(process.env.RAILWAY_ENVIRONMENT);
}

function getR2Config() {
  const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  const bucket = process.env.R2_BUCKET;
  if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !bucket) return null;
  return {
    endpoint: R2_ENDPOINT,
    bucket,
    region: process.env.R2_REGION || 'auto',
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY }
  };
}

function getS3Client(config) {
  if (!s3Client) {
    s3Client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: config.credentials
    });
  }
  return s3Client;
}

function getEncryptionKey() {
  const configured = String(process.env.ENCRYPTION_KEY || '').trim();
  let masterKey;
  if (/^[0-9a-f]{64}$/i.test(configured)) {
    masterKey = Buffer.from(configured, 'hex');
  } else if (Buffer.byteLength(configured, 'utf8') === 32) {
    masterKey = Buffer.from(configured, 'utf8');
  } else {
    throw new Error('ENCRYPTION_KEY debe tener 32 bytes o 64 caracteres hexadecimales para proteger documentos SaaS.');
  }
  return Buffer.from(crypto.hkdfSync('sha256', masterKey, Buffer.alloc(0), KEY_CONTEXT, 32));
}

function encryptDocument(buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

function decryptDocument(payload) {
  if (!Buffer.isBuffer(payload) || payload.length < MAGIC.length + 12 + 16 || !payload.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('El documento de facturación almacenado tiene un formato inválido.');
  }
  const ivStart = MAGIC.length;
  const tagStart = ivStart + 12;
  const dataStart = tagStart + 16;
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), payload.subarray(ivStart, tagStart));
  decipher.setAuthTag(payload.subarray(tagStart, dataStart));
  return Buffer.concat([decipher.update(payload.subarray(dataStart)), decipher.final()]);
}

function buildObjectKey(tenantId, invoiceNumber, extension) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(String(tenantId || '')) || !/^INV-[0-9]{6}-[0-9]{4,}$/.test(String(invoiceNumber || ''))) {
    throw new Error('Identificador de tenant o número de comprobante inválido.');
  }
  return `private/saas-invoices/${tenantId}/${invoiceNumber}.${extension}.enc`;
}

async function storeInvoiceDocument({ tenantId, invoiceNumber, buffer, contentType, extension }) {
  const key = buildObjectKey(tenantId, invoiceNumber, extension);
  const config = getR2Config();
  if (config) {
    const encryptedBody = encryptDocument(buffer);
    await getS3Client(config).send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: encryptedBody,
      ContentType: 'application/octet-stream',
      CacheControl: 'private, no-store',
      Metadata: { documenttype: contentType, encryption: 'aes-256-gcm-v1' }
    }));
    return { storage: 'r2', key, contentType, extension };
  }

  if (isProduction()) {
    throw new Error('El almacenamiento R2 de comprobantes SaaS no está configurado; no se guardará el documento en disco efímero.');
  }

  const tenantDirectory = path.join(LOCAL_INVOICE_DIR, tenantId);
  await fs.mkdir(tenantDirectory, { recursive: true, mode: 0o700 });
  const filename = `${invoiceNumber}.${extension}`;
  await fs.writeFile(path.join(tenantDirectory, filename), buffer, { mode: 0o600 });
  return { storage: 'local', key: null, contentType, extension };
}

function isMissingObject(error) {
  return error?.name === 'NoSuchKey' || error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404;
}

async function loadInvoiceDocument({ tenantId, invoiceNumber }) {
  const pdfKey = buildObjectKey(tenantId, invoiceNumber, 'pdf');
  const config = getR2Config();
  if (config) {
    const client = getS3Client(config);
    for (const extension of ['pdf', 'html']) {
      const key = extension === 'pdf' ? pdfKey : buildObjectKey(tenantId, invoiceNumber, extension);
      try {
        const object = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
        const encryptedBody = Buffer.from(await object.Body.transformToByteArray());
        return {
          buffer: decryptDocument(encryptedBody),
          contentType: extension === 'pdf' ? 'application/pdf' : 'text/html; charset=utf-8',
          extension
        };
      } catch (error) {
        if (!isMissingObject(error)) throw error;
      }
    }
  }

  if (isProduction()) return null;
  const tenantDirectory = path.join(LOCAL_INVOICE_DIR, tenantId);
  for (const extension of ['pdf', 'html']) {
    const filename = `${invoiceNumber}.${extension}`;
    try {
      return {
        buffer: await fs.readFile(path.join(tenantDirectory, filename)),
        contentType: extension === 'pdf' ? 'application/pdf' : 'text/html; charset=utf-8',
        extension
      };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return null;
}

module.exports = {
  storeInvoiceDocument,
  loadInvoiceDocument,
  _encryptDocument: encryptDocument,
  _decryptDocument: decryptDocument,
  _buildObjectKey: buildObjectKey
};

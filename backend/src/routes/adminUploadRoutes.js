const express = require('express');
const router = express.Router();
const { wrapRouterAsync } = require('../utils/expressAsync');
const { authMiddleware } = require('../middleware/auth');
const { requireRol } = require('../middleware/roles');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

// Configuración R2/S3
const R2_CONFIG = {
  region: process.env.R2_REGION || 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
};

const BUCKET = process.env.R2_BUCKET || 'glowapp-products';
const CDN_BASE = process.env.R2_CDN_BASE || `https://cdn.glowapp.co`; // Dominio personalizado

const s3Client = new S3Client(R2_CONFIG);

router.use(authMiddleware);
router.use(requireRol('admin'));

/**
 * POST /api/admin/upload/presigned
 * Genera presigned PUT URL para upload directo a R2/S3
 * Body: { filename: "imagen.jpg", contentType: "image/jpeg", folder?: "products" }
 * Returns: { uploadUrl, fileUrl, key, expiresIn }
 */
router.post('/upload/presigned', async (req, res) => {
  try {
    const { filename, contentType, folder = 'products' } = req.body || {};

    if (!filename || !contentType) {
      return res.status(400).json({ 
        error: 'INVALID_ARGUMENT', 
        message: 'filename y contentType son obligatorios' 
      });
    }

    // Validar contentType
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(contentType)) {
      return res.status(400).json({ 
        error: 'INVALID_ARGUMENT', 
        message: 'Tipo de archivo no permitido. Solo JPEG, PNG, WebP, GIF' 
      });
    }

    // Generar key única
    const ext = filename.split('.').pop().toLowerCase();
    const key = `${folder}/${crypto.randomUUID()}.${ext}`;

    // Presigned PUT URL (expiración 5 min)
    const putCommand = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(s3Client, putCommand, { expiresIn: 300 });

    // URL pública CDN (o presigned GET 24h si no hay CDN)
    let fileUrl;
    if (CDN_BASE && CDN_BASE !== `https://cdn.glowapp.co`) {
      fileUrl = `${CDN_BASE}/${key}`;
    } else {
      const getCommand = new GetObjectCommand({ Bucket: BUCKET, Key: key });
      fileUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: 86400 });
    }

    return res.json({
      success: true,
      data: {
        uploadUrl,
        fileUrl,
        key,
        bucket: BUCKET,
        expiresIn: 300, // 5 minutos
        cdnUrl: CDN_BASE ? `${CDN_BASE}/${key}` : null
      }
    });
  } catch (error) {
    console.error('Error generando presigned URL:', error);
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: error.message });
  }
});

/**
 * POST /api/admin/upload/confirm
 * Confirma upload y opcionalmente procesa con Sharp (crear thumbnails, etc.)
 * Body: { key, processed: true/false }
 * Returns: { fileUrl, cdnUrl, variants }
 */
router.post('/upload/confirm', async (req, res) => {
  try {
    const { key, processed = false } = req.body || {};

    if (!key) {
      return res.status(400).json({ error: 'INVALID_ARGUMENT', message: 'key es obligatoria' });
    }

    // Verificar que el objeto existe en el bucket
    const { HeadObjectCommand } = require('@aws-sdk/client-s3');
    try {
      await s3Client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    } catch (e) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Archivo no encontrado en bucket' });
    }

    let fileUrl = `${CDN_BASE}/${key}`;
    let variants = { original: fileUrl };

    // Si se solicita procesamiento con Sharp (thumbnails, WebP, etc.)
    // Esto requeriría descargar, procesar con Sharp, y re-subir variantes
    // Para MVP, solo retornamos la URL original
    if (processed) {
      // TODO: Implementar procesamiento Sharp vía Worker/Lambda
      // Por ahora solo marcamos que se requiere procesamiento
      variants = { 
        original: fileUrl,
        requiresProcessing: true,
        note: 'Procesamiento Sharp pendiente - implementar Worker/Lambda'
      };
    }

    return res.json({
      success: true,
      data: {
        fileUrl,
        cdnUrl: fileUrl,
        key,
        variants
      }
    });
  } catch (error) {
    console.error('Error confirmando upload:', error);
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: error.message });
  }
});

// Universal: envuelve TODOS los handlers async
wrapRouterAsync(router);

module.exports = router;
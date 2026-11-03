const { wrapRouterAsync } = require('../../utils/expressAsync');
const express = require('express');
const router = express.Router();
const fs = require('fs');
const FormData = require('form-data');
const axios = require('axios');
const { authMiddleware } = require('../../middleware/auth');
const multer = require('multer');

// Usar el mismo destino de uploads que index.js o uno temporal
const upload = multer({ dest: 'uploads/' });

const AI_WORKER_URL = process.env.AI_WORKER_URL || 'http://ai-worker:8000';

router.post('/', authMiddleware, upload.fields([
  { name: 'face_frontal', maxCount: 1 },
  { name: 'face_lateral', maxCount: 1 },
  { name: 'hair', maxCount: 1 },
  { name: 'hand', maxCount: 1 }
]), async (req, res) => {
  try {
    if (!req.files || !req.files.face_frontal || !req.files.face_lateral || !req.files.hair || !req.files.hand) {
      return res.status(400).json({ error: 'Se requieren las 4 imagenes: face_frontal, face_lateral, hair, hand.' });
    }

    const formData = new FormData();
    const userIdVal = req.body.user_id || req.user.id;
    formData.append('user_id', userIdVal.toString());
    
    formData.append('face_frontal', fs.createReadStream(req.files.face_frontal[0].path), {
      filename: req.files.face_frontal[0].originalname,
      contentType: req.files.face_frontal[0].mimetype
    });
    formData.append('face_lateral', fs.createReadStream(req.files.face_lateral[0].path), {
      filename: req.files.face_lateral[0].originalname,
      contentType: req.files.face_lateral[0].mimetype
    });
    formData.append('hair', fs.createReadStream(req.files.hair[0].path), {
      filename: req.files.hair[0].originalname,
      contentType: req.files.hair[0].mimetype
    });
    formData.append('hand', fs.createReadStream(req.files.hand[0].path), {
      filename: req.files.hand[0].originalname,
      contentType: req.files.hand[0].mimetype
    });

    const response = await axios.post(`${AI_WORKER_URL}/api/v1/beauty-scan`, formData, {
      headers: {
        ...formData.getHeaders(),
        'Authorization': req.header('Authorization')
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    // Limpieza asincrona de archivos temporales
    const pathsToUnlink = [
      req.files.face_frontal[0].path,
      req.files.face_lateral[0].path,
      req.files.hair[0].path,
      req.files.hand[0].path
    ];
    pathsToUnlink.forEach(filePath => {
      fs.unlink(filePath, (err) => {
        if (err) console.error(`Error limpiando archivo temporal ${filePath}:`, err.message);
      });
    });

    return res.status(response.status).json(response.data);

  } catch (error) {
    console.error('Error en el proxy /api/v1/beauty-scan:', error.message);
    if (req.files) {
      const allFiles = [
        req.files.face_frontal?.[0]?.path,
        req.files.face_lateral?.[0]?.path,
        req.files.hair?.[0]?.path,
        req.files.hand?.[0]?.path
      ];
      allFiles.forEach(filePath => {
        if (filePath && fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      });
    }
    // Alineacion de contrato: si el worker respondio un 4xx (imagen corrupta,
    // sin rostro detectable, campo faltante), se propaga su codigo y detalle en
    // lugar de enmascararlo con un 500 generico.
    if (error.response) {
      return res.status(error.response.status).json(error.response.data);
    }
    return res.status(500).json({ error: 'Error procesando escaneo capilar/facial' });
  }
});

wrapRouterAsync(router);
module.exports = router;

// src/routes/socialRoutes.js
const express = require('express');
const Joi = require('joi');
const { wrapRouterAsync } = require('../utils/expressAsync');
const { authMiddleware } = require('../middleware/auth');
const socialController = require('../controllers/socialController');

const router = express.Router();

const shareSchema = Joi.object({
  platform: Joi.string()
    .valid(...socialController.PLATAFORMAS)
    .required(),
  content_type: Joi.string()
    .valid(...socialController.TIPOS)
    .required(),
  share_reference_id: Joi.string().max(120).allow(null, ''),
}).unknown(true);

// El cliente manda `platform` en mayúsculas, pero se normaliza igual: un
// `tiktok` en minúsculas no debe ser un 400 por ortografía.
function normalizar(req, _res, next) {
  if (req.body) {
    if (typeof req.body.platform === 'string') {
      req.body.platform = req.body.platform.toUpperCase();
    }
    if (typeof req.body.content_type === 'string') {
      req.body.content_type = req.body.content_type.toUpperCase();
    }
  }
  next();
}

function validar(schema) {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }
    next();
  };
}

// POST /api/social/log-share — registra un compartir y otorga XP (1/día por contenido)
router.post('/log-share', authMiddleware, normalizar, validar(shareSchema), socialController.logShare);

wrapRouterAsync(router);

module.exports = router;

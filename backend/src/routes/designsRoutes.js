const { wrapRouterAsync } = require('../utils/expressAsync');
// backend/src/routes/designsRoutes.js
const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const { 
  searchPinterestDesigns, 
  analyzeFaceShape, 
  analyzeDesign, 
  proxyImage, 
  getAIHistory, 
  compareDesigns, 
  getSkinProfile, 
  checkGlowAIQuota, 
  subscribePremium, 
  checkInStreak, 
  getShareCode, 
  redirectReferral, 
  getRecommendedDoctors,
  getEvolutionData,
  getEvolutionInsight,
  getEvolutionAttribution,
  requestMedicalValidation,
  payMedicalValidation,
  getValidationHistory,
  getValidationById,
  getCuratedCollections,
  getExclusiveCollections,
  generateGlowUpCard,
  checkColorimetriaQuota,
  getColorimetriaHistorial,
  classifyGarment,
  generateOutfit,
  getWardrobe,
  deleteGarment,
  getOutfitHistorial,
  checkOutfitQuota
} = require('../controllers/designsController');
const { authMiddleware } = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // Límite de 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype) || file.mimetype === 'application/octet-stream' || !file.mimetype;
    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes (.jpeg, .jpg, .png, .gif, .webp)'));
    }
  }
});

router.get('/proxy', proxyImage);
router.get('/history', authMiddleware, getAIHistory);
router.get('/profile', authMiddleware, getSkinProfile);
router.get('/search', authMiddleware, searchPinterestDesigns);
router.get('/share/code', authMiddleware, getShareCode);
router.get('/share/go/:code', redirectReferral);
router.get('/profesionales/recommend', authMiddleware, getRecommendedDoctors);
router.post('/face-analysis', authMiddleware, upload.single('image'), analyzeFaceShape);
router.post('/analyze', authMiddleware, checkColorimetriaQuota, checkGlowAIQuota, upload.single('image'), analyzeDesign);
router.post('/compare', authMiddleware, upload.fields([{ name: 'imageBefore', maxCount: 1 }, { name: 'imageAfter', maxCount: 1 }]), compareDesigns);
router.post('/payments/glowai-premium', authMiddleware, subscribePremium);
router.post('/streak/check-in', authMiddleware, checkInStreak);

// 🔹 NUEVO: Historial de Colorimetría
router.get('/colorimetria/historial', authMiddleware, getColorimetriaHistorial);

// 🔹 NUEVO: Evolución Premium
router.get('/evolution/:track', authMiddleware, getEvolutionData);
router.get('/evolution/:track/insight', authMiddleware, getEvolutionInsight);
router.get('/evolution/:track/attribution', authMiddleware, getEvolutionAttribution);

// 🔹 NUEVO: Validación Médica
router.post('/validation/request', authMiddleware, requestMedicalValidation);
router.post('/validation/pay', authMiddleware, payMedicalValidation);
router.get('/validation/user/history', authMiddleware, getValidationHistory);
router.get('/validation/:id', authMiddleware, getValidationById);

// 🔹 NUEVO: Colecciones y Tarjetas de Conversión (Mejoras de Rediseño)
router.get('/collections', authMiddleware, getCuratedCollections);
router.get('/collections/exclusive', authMiddleware, getExclusiveCollections);
router.post('/glowup-card/generate', authMiddleware, generateGlowUpCard);

// 🔹 NUEVO: Clóset e Imagen Digital (GlowStyle)
router.post('/wardrobe/garment', authMiddleware, upload.single('image'), classifyGarment);
router.get('/wardrobe', authMiddleware, getWardrobe);
router.delete('/wardrobe/garment/:id', authMiddleware, deleteGarment);
router.post('/wardrobe/outfit/generate', authMiddleware, checkOutfitQuota, generateOutfit);
router.get('/wardrobe/outfits/history', authMiddleware, getOutfitHistorial);

wrapRouterAsync(router);
module.exports = router;

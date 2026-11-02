const { wrapRouterAsync } = require('../utils/expressAsync');
// backend/src/routes/productRoutes.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { requireRol } = require('../middleware/roles');
const productController = require('../controllers/productController');
const orderController = require('../controllers/orderController');
const openBeautyFacts = require('../services/openBeautyFacts');
const profileService = require('../services/biometric/profile.service');

// Helper function to validate userId
const validateUserId = (userId) => {
  if (userId === undefined || userId === null) return false;
  // Convert to string if it's a number
  const str = String(userId);
  // Check if it's a valid integer (no decimals, no leading zeros except for "0" itself)
  if (!/^\d+$/.test(str)) return false;
  // Check for reasonable range (assuming user IDs are positive and not excessively large)
  const num = parseInt(str, 10);
  return num > 0 && num <= 999999; // Reasonable upper bound for user IDs
};

// Obtener catálogo de productos (soporta filtros por tag de especialidad)
router.get('/products', productController.getProducts);

// Obtener un producto por ID
router.get('/products/:id', productController.getProductById);

// Listar el catálogo completo para el panel admin (paginado)
router.get('/admin/products', authMiddleware, requireRol('admin'), productController.getAdminProducts);

// Cargar un producto (Administrador de catálogo)
// Extensión futura: admin || (provider && tenant propietario), gestionado por RLS.
router.post('/admin/products', authMiddleware, requireRol('admin'), productController.createProduct);

// Actualizar un producto (Administrador de catálogo)
router.put('/admin/products/:id', authMiddleware, requireRol('admin'), productController.updateProduct);

// Eliminar un producto (Administrador de catálogo)
router.delete('/admin/products/:id', authMiddleware, requireRol('admin'), productController.deleteProduct);

// --- Rutas de Pedidos de GlowStore ---
router.post('/store/envio/cotizacion', authMiddleware, orderController.cotizarEnvio);
router.post('/store/checkout', authMiddleware, orderController.createOrder);
router.get('/store/orders', authMiddleware, orderController.getOrders);
router.get('/store/orders/:id', authMiddleware, orderController.getOrderById);
router.post('/store/orders/:id/pay', authMiddleware, orderController.payOrder);
router.post('/payments/store-webhook', orderController.storeWebhook);

// --- Rutas públicas de cotización de envío (L5) ---
router.get('/store/shipping/quote', orderController.cotizarEnvioPublic);

// --- Rutas Admin para Gestión de Pedidos GlowStore ---
router.get('/admin/store/orders', authMiddleware, requireRol('admin'), orderController.getAllStoreOrdersAdmin);
router.post('/admin/store/orders/:id/dispatch', authMiddleware, requireRol('admin'), orderController.dispatchOrder);
router.post('/admin/store/orders/:id/deliver', authMiddleware, requireRol('admin'), orderController.deliverOrder);
router.post('/admin/store/orders/:id/cancel', authMiddleware, requireRol('admin'), orderController.cancelOrder);
router.get('/admin/envios/:guia', authMiddleware, requireRol('admin'), orderController.getEnvioByGuia);
router.patch('/admin/envios/:guia/status', authMiddleware, requireRol('admin'), orderController.updateEnvioStatus);

// POST /api/biometric/check
router.post('/biometric/check', authMiddleware, async (req, res) => {
  const { userId, barcode } = req.body;

  if (!userId || !barcode) {
    return res.status(400).json({
      error: 'userId y barcode son obligatorios'
    });
  }

  // Validate userId format
  if (!validateUserId(userId)) {
    return res.status(400).json({
      error: 'userId debe ser un número entero positivo válido'
    });
  }

  const userIdNum = parseInt(userId, 10);

  // Ownership check: user can only check compatibility for their own profile
  if (req.user?.id !== userIdNum && req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'No tienes permisos para acceder a este perfil.' });
  }

  try {
    const product = await openBeautyFacts.searchByBarcode(barcode);
    if (!product) {
      return res.status(404).json({
        error: 'Producto no encontrado en la base de datos de Open Beauty Facts'
      });
    }

    const profile = await profileService.getProfile(userIdNum);
    let compatible = false;
    let reason = '';

    if (profile) {
      const ingredients = (product.ingredients || '').toLowerCase();
      const faceScores = profile.faceScores || {};

      if (faceScores.hydration < 50 && ingredients.includes('ácido hialurónico')) {
        compatible = true;
        reason = 'Este producto contiene ácido hialurónico, ideal para tu piel deshidratada.';
      } else if (faceScores.spots > 60 && (ingredients.includes('vitamina c') || ingredients.includes('niacinamida'))) {
        compatible = true;
        reason = 'Contiene vitamina C o niacinamida, que ayudan a reducir manchas faciales.';
      } else if (faceScores.wrinkles > 50 && ingredients.includes('retinol')) {
        compatible = true;
        reason = 'El retinol es excelente para tratar tus líneas de expresión y arrugas.';
      } else {
        compatible = false;
        reason = 'Este producto no parece alinearse con las necesidades específicas de tu piel en este momento.';
      }
    } else {
      reason = 'No tenemos tu perfil biométrico. Escanea tu piel para obtener recomendaciones personalizadas.';
    }

    res.json({
      success: true,
      product: {
        ...product,
        compatible,
        compatibilityReason: reason,
      }
    });
  } catch (error) {
    console.error('Error en /biometric/check:', error);
    res.status(500).json({
      error: 'Error al verificar el producto'
    });
  }
});

// GET /api/biometric/recommended/:userId
router.get('/biometric/recommended/:userId', authMiddleware, async (req, res) => {
  const { userId } = req.params;

  // Validate userId format
  if (!validateUserId(userId)) {
    return res.status(400).json({ error: 'userId debe ser un número entero positivo válido' });
  }

  const userIdNum = parseInt(userId, 10);

  // Ownership check: user can only get recommendations for their own profile
  if (req.user?.id !== userIdNum && req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'No tienes permisos para acceder a este perfil.' });
  }

  try {
    const profile = await profileService.getProfile(userIdNum);
    if (!profile) {
      return res.status(404).json({ error: 'Perfil biométrico no encontrado' });
    }

    const keyIngredients = profile.keyIngredients || [];
    if (keyIngredients.length === 0) {
      return res.json({ products: [] });
    }

    const products = await openBeautyFacts.getRecommendedProducts(keyIngredients, 5);
    res.json({ products });
  } catch (error) {
    console.error('Error en /biometric/recommended:', error);
    res.status(500).json({ error: 'Error al obtener productos recomendados' });
  }
});

wrapRouterAsync(router);
module.exports = router;
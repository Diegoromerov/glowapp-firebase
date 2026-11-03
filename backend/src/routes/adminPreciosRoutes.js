const express = require('express');
const router = express.Router();
const { wrapRouterAsync } = require('../utils/expressAsync');
const multer = require('multer');
const { authMiddleware } = require('../middleware/auth');
const { requireRol } = require('../middleware/roles');
const {
  getPrecios,
  getPrecioProducto,
  updatePrecioProducto,
  bulkUpdatePrecios,
  getCoherenciaReport,
  exportPreciosCsv,
  importPreciosCsv,
  getHistorialPrecios
} = require('../controllers/adminPreciosController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

const { adminAuditLog } = require('../middleware/adminAuditLog');

// Todas las rutas de administración de precios están protegidas con autenticación y rol 'admin'
router.use(authMiddleware);
router.use(requireRol('admin'));

router.get('/precios', getPrecios);
router.get('/precios/coherencia', getCoherenciaReport);
router.get('/precios/historial', getHistorialPrecios);
router.get('/precios/export.csv', exportPreciosCsv);
// Ojo con el orden: va DESPUES de coherencia/historial/export.csv para que esas
// rutas literales no caigan en el :productoId.
// DECISION 2026-10-09 (Diego): el id va acotado a digitos. Un segmento no numerico
// (/api/admin/precios/precios) no es una peticion mal formada ni un id valido: ninguna
// ruta la sirve, asi que debe caer a 404, no a 400.
router.get('/precios/:productoId(\\d+)', getPrecioProducto);
router.post('/precios/import.csv', upload.single('archivo'), adminAuditLog({ action: 'precios.import_csv', resource: 'precios' }), importPreciosCsv);
router.put('/precios/:productoId(\\d+)', adminAuditLog({ action: 'precios.update', resource: 'precios' }), updatePrecioProducto);
router.patch('/precios/bulk', adminAuditLog({ action: 'precios.bulk_update', resource: 'precios' }), bulkUpdatePrecios);

// Universal: envuelve TODOS los handlers async de este router (rutas y middleware)
// para que un rechazo async llegue a next(err) en vez de tumbar el proceso.
wrapRouterAsync(router);

module.exports = router;

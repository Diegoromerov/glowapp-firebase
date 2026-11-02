// backend/src/routes/adminTicketRoutes.js
//
// Gestión de PQRSF desde el panel. Se monta en `/api/admin`, así que los caminos de
// abajo quedan como `/api/admin/tickets...`.
//
// El guardia es de router entero (`use`) para que no se pueda añadir una ruta nueva aquí
// y olvidarse del rol: en este repo ya se ha colado una asimetría así (un GET sin ruta
// porque se daba por hecho que el PUT simétrico existía).
const { wrapRouterAsync } = require('../utils/expressAsync');
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { requireRol } = require('../middleware/roles');
const { adminAuditLog } = require('../middleware/adminAuditLog');
const adminTicketController = require('../controllers/adminTicketController');

router.use(authMiddleware);
router.use(requireRol('admin'));

// `/tickets/metricas` y `/tickets/esquema` ANTES que `/tickets/:id`: si no, esos nombres
// se interpretan como un id y la petición muere en el guardia de formato.
router.get('/tickets/metricas', adminTicketController.metricasTickets);
router.get('/tickets/esquema', adminTicketController.esquemaTickets);
router.get('/tickets', adminTicketController.listarTickets);
router.get('/tickets/:id', adminTicketController.detalleTicket);

// Las dos escrituras quedan auditadas (admin_audit_logs): son acciones sobre datos de un
// usuario y, en el caso ARCO, sobre una obligación legal.
router.patch(
  '/tickets/:id',
  adminAuditLog({ action: 'tickets.actualizar', resource: 'ticket' }),
  adminTicketController.actualizarTicket
);
router.post(
  '/tickets/:id/respuesta',
  adminAuditLog({ action: 'tickets.responder', resource: 'ticket' }),
  adminTicketController.responderTicket
);

wrapRouterAsync(router);

module.exports = router;

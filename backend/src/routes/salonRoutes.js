const { wrapRouterAsync } = require('../utils/expressAsync');
const express = require('express');
const router = express.Router();
const {
  createSalon,
  inviteMember,
  acceptInvitation,
  getSalonMembers,
  getMySalon,
  updateMemberRole,
  removeMember,
} = require('../controllers/salonController');
const { authMiddleware } = require('../middleware/auth');
const { requireSalonEntitlement } = require('../middleware/salonEntitlement');
const {
  listarInventario: getInventarioSalon,
  crearItem: postInventarioItem,
  registrarMovimiento: postInventarioMovimiento,
  historialItem: getInventarioHistorial,
  listarRecursos: getRecursos,
  crearRecurso: postRecurso,
  crearAlquiler: postAlquiler,
  listarAlquileres: getAlquileres,
} = require('../controllers/salonOpsController');
const {
  resumen: getCajaResumen,
  movimientos: getCajaMovimientos,
  registrar: postCajaMovimiento,
  constancia: getCajaConstancia,
} = require('../controllers/cajaController');
const {
  requireOwnerRole,
  requireSalonAdmin,
  requireSalonRole,
  protectOwnerMember,
  SUB_ROLES,
} = require('../middleware/ownerGuard');

router.get('/my-salon', authMiddleware, getMySalon);
router.post('/create', authMiddleware, createSalon);

// requireSalonAdmin resuelve y valida salon_id del body antes del controlador
// y deja req.salonId / req.salonMembership disponibles (defensa en profundidad:
// salonController.inviteMember conserva su propio chequeo interno).
router.post('/invite', authMiddleware, requireSalonAdmin, requireSalonEntitlement('TEAM_MANAGEMENT'), inviteMember);

router.post('/accept-invitation', authMiddleware, acceptInvitation);

// Cualquier miembro ACTIVO del salón puede listar el equipo; el salon_id de la
// URL se valida contra salon_miembros y no se toma como verdad del cliente.
router.get(
  '/:salonId/members',
  authMiddleware,
  requireSalonRole(
    SUB_ROLES.DUENO,
    SUB_ROLES.ADMINISTRADOR,
    SUB_ROLES.PRESTADOR_INDEPENDIENTE,
    SUB_ROLES.EMPLEADO,
    SUB_ROLES.RECEPCIONISTA
  ),
  getSalonMembers
);

// Endpoints exclusivos del Propietario (OWNER) para gestión de colaboradores
router.patch(
  '/:salonId/members/:memberId/role',
  authMiddleware,
  requireOwnerRole,
  protectOwnerMember,
  updateMemberRole
);

router.delete(
  '/:salonId/members/:memberId',
  authMiddleware,
  requireOwnerRole,
  protectOwnerMember,
  removeMember
);

wrapRouterAsync(router);
module.exports = router;

// ── Caja (E-05, D-GL-027) ────────────────────────────────────────────────────
// Leer la caja: cualquier miembro activo. El controlador recorta a «lo mío»
// cuando el rol no es de administración, así que un colaborador no puede ver la
// caja del salón ni pidiéndola por URL.
const ROLES_CAJA_LECTURA = [
  SUB_ROLES.DUENO,
  SUB_ROLES.ADMINISTRADOR,
  SUB_ROLES.RECEPCIONISTA,
  SUB_ROLES.PRESTADOR_INDEPENDIENTE,
  SUB_ROLES.EMPLEADO,
];

// Registrar dinero: administración y recepción. No el colaborador.
const ROLES_CAJA_REGISTRO = [
  SUB_ROLES.DUENO,
  SUB_ROLES.ADMINISTRADOR,
  SUB_ROLES.RECEPCIONISTA,
];

router.get(
  '/:salonId/caja/resumen',
  authMiddleware,
  requireSalonRole(...ROLES_CAJA_LECTURA),
  getCajaResumen
);

router.get(
  '/:salonId/caja/movimientos',
  authMiddleware,
  requireSalonRole(...ROLES_CAJA_LECTURA),
  getCajaMovimientos
);

router.post(
  '/:salonId/caja/movimientos',
  authMiddleware,
  requireSalonRole(...ROLES_CAJA_REGISTRO),
  postCajaMovimiento
);

router.get(
  '/:salonId/caja/movimientos/:movimientoId/constancia',
  authMiddleware,
  requireSalonRole(...ROLES_CAJA_LECTURA),
  getCajaConstancia
);

// ── Inventario y alquileres (E-06, D-GL-027) ─────────────────────────────────
// Leer: cualquier miembro activo (el controlador recorta los alquileres a «lo
// mío» cuando el rol no administra). Escribir: lo valida el controlador.
router.get(
  '/:salonId/inventario',
  authMiddleware,
  requireSalonRole(...ROLES_CAJA_LECTURA),
  getInventarioSalon
);

router.post(
  '/:salonId/inventario',
  authMiddleware,
  requireSalonRole(...ROLES_CAJA_LECTURA),
  postInventarioItem
);

router.post(
  '/:salonId/inventario/:itemId/movimientos',
  authMiddleware,
  requireSalonRole(...ROLES_CAJA_LECTURA),
  postInventarioMovimiento
);

router.get(
  '/:salonId/inventario/:itemId/movimientos',
  authMiddleware,
  requireSalonRole(...ROLES_CAJA_LECTURA),
  getInventarioHistorial
);

router.get(
  '/:salonId/recursos',
  authMiddleware,
  requireSalonRole(...ROLES_CAJA_LECTURA),
  getRecursos
);

router.post(
  '/:salonId/recursos',
  authMiddleware,
  requireSalonRole(...ROLES_CAJA_LECTURA),
  postRecurso
);

router.get(
  '/:salonId/alquileres',
  authMiddleware,
  requireSalonRole(...ROLES_CAJA_LECTURA),
  getAlquileres
);

router.post(
  '/:salonId/alquileres',
  authMiddleware,
  requireSalonRole(...ROLES_CAJA_LECTURA),
  postAlquiler
);

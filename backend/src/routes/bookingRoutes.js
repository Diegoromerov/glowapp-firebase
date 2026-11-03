const { wrapRouterAsync } = require('../utils/expressAsync');
// backend/src/routes/bookingRoutes.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const pilaCheck = require('../middleware/pilaCheck');
const bookingController = require('../controllers/bookingController');
const tipController = require('../controllers/tipController');
const creditController = require('../controllers/creditController');

// 🔹 CREAR RESERVA
router.post('/bookings', authMiddleware, bookingController.createBooking);

// 🔹 PANEL DE PRESTADOR: OBTENER CITAS
router.get('/bookings/provider', authMiddleware, pilaCheck, bookingController.getProviderBookings);

// 🔹 HISTORIAL DE CITAS DEL CLIENTE
router.get('/bookings/client', authMiddleware, bookingController.getClientBookings);

// 🔹 ACTUALIZAR ESTADO DE CITA
router.patch('/bookings/:id/status', authMiddleware, pilaCheck, bookingController.updateBookingStatus);

// 🔹 CANCELAR CITA
router.patch('/bookings/:id/cancel', authMiddleware, bookingController.cancelBooking);

// D-GL-023 — reprogramación única (bloqueo en API) y cancelación del prestador
router.patch('/bookings/:id/reschedule', authMiddleware, bookingController.rescheduleBooking);
router.patch('/bookings/:id/cancel-provider', authMiddleware, pilaCheck, bookingController.cancelBookingByProvider);

// D-GL-023 — propina (100% al prestador) y compensación por no-show en créditos
router.post('/bookings/:id/tip', authMiddleware, tipController.createTip);
router.get('/bookings/:id/tip', authMiddleware, tipController.getTip);
router.post('/bookings/:id/no-show', authMiddleware, creditController.reportProviderNoShow);

// Créditos del usuario
router.get('/credits/me', authMiddleware, creditController.getMyCredits);
router.post('/credits/apply', authMiddleware, creditController.applyCredit);

// 🔹 SIMULAR PAGO CON WOMPI
router.post('/bookings/:id/pay', authMiddleware, bookingController.payBooking);

// 🔹 WEBHOOK SIMULADO DE WOMPI
router.post('/payments/wompi-webhook', bookingController.wompiWebhook);

// 🔹 CREAR RESEÑA
router.post('/bookings/:id/review', authMiddleware, bookingController.createReview);

// 🔹 INICIAR SERVICIO
router.patch('/bookings/:id/start', authMiddleware, pilaCheck, bookingController.startService);

wrapRouterAsync(router);
module.exports = router;


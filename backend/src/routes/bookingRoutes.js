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

// Enlace de pago (Web Checkout de Wompi) para una cita en PENDIENTE_PAGO.
// El cliente lo abre desde "Mis citas"; la firma de integridad la calcula el backend.
router.post('/bookings/:id/payment-link', authMiddleware, bookingController.createBookingPaymentLink);

// D-GL-023 — reprogramación única (bloqueo en API) y cancelación del prestador
router.patch('/bookings/:id/reschedule', authMiddleware, bookingController.rescheduleBooking);
router.patch('/bookings/:id/cancel-provider', authMiddleware, pilaCheck, bookingController.cancelBookingByProvider);

// D-GL-023 — propina (100% al prestador) y compensación por no-show en créditos
router.post('/bookings/:id/tip', authMiddleware, tipController.createTip);
router.get('/bookings/:id/tip', authMiddleware, tipController.getTip);
// Ítem 31 — recibo: comprobante imprimible y envío al correo de la cuenta.
router.get('/bookings/:id/receipt', authMiddleware, bookingController.getBookingReceipt);
router.post('/bookings/:id/receipt/email', authMiddleware, bookingController.emailBookingReceipt);
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


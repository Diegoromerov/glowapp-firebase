// backend/src/services/fcmNotificationService.js
/**
 * Servicio de Notificaciones Push FCM (Firebase Cloud Messaging)
 * Soporta alertas de reservas en tiempo real, insumos bajo stock y retiros de billetera SaaS.
 */
const logger = require('../config/logger');

class FCMNotificationService {
  constructor() {
    this.initialized = false;
    this._initFirebase();
  }

  _initFirebase() {
    try {
      if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        const admin = require('firebase-admin');
        // Railway guarda el JSON entre comillas, así que `JSON.parse` devuelve
        // una CADENA con el JSON dentro y `cert()` recibe un string: el SDK
        // fallaba al inicializar y ninguna push salía. Se parsea dos veces.
        let serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        if (typeof serviceAccount === 'string') {
          serviceAccount = JSON.parse(serviceAccount);
        }
        if (!serviceAccount || !serviceAccount.private_key) {
          throw new Error('FIREBASE_SERVICE_ACCOUNT no contiene una cuenta de servicio válida');
        }
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
        this.admin = admin;
        this.initialized = true;
        logger.info('🔔 FCM Push Notification Engine inicializado correctamente.');
      } else {
        logger.warn('⚠️ FIREBASE_SERVICE_ACCOUNT no configurado; FCM corriendo en modo Simulación/Logger.');
      }
    } catch (error) {
      logger.error(`❌ Error al inicializar Firebase Admin SDK: ${error.message}`);
    }
  }

  /** Enviar notificación de nueva cita o cambio de estado */
  async sendBookingPushNotification(deviceToken, { bookingId, status, clientName, serviceName, scheduledAt }) {
    const title = status === 'CONFIRMED' ? '📅 ¡Nueva Cita Confirmada!' : `📱 Cita Actualizada (${status})`;
    const body = `${clientName} reservó ${serviceName} para el ${scheduledAt || 'horario agendado'}.`;

    return await this._sendNotification(deviceToken, title, body, {
      type: 'BOOKING_UPDATE',
      bookingId: String(bookingId),
      status,
    });
  }

  /**
   * Aviso de que el servicio terminó y el código está disponible.
   * El código NO viaja en la notificación: una push se lee desde la pantalla
   * bloqueada y cualquiera con el teléfono en la mano lo vería. Va por correo.
   */
  async sendOtpReadyNotice(deviceToken, { bookingId, serviceName }) {
    const title = 'Confirma tu servicio';
    const body = `El servicio de ${serviceName || 'tu cita'} terminó. Abre GlowApp e ingresa el código que enviamos a tu correo.`;

    return await this._sendNotification(deviceToken, title, body, {
      type: 'OTP_READY',
      bookingId: String(bookingId),
    });
  }

  /** Enviar alerta de stock crítico de insumo en consignación */
  async sendConsignmentStockAlert(deviceToken, { productoId, productoNombre, cantidadDisponible }) {
    const title = '⚠️ Alerta de Stock Mínimo en Consignación';
    const body = `El insumo "${productoNombre}" tiene solo ${cantidadDisponible} unidades disponibles.`;

    return await this._sendNotification(deviceToken, title, body, {
      type: 'CONSIGNMENT_STOCK_ALERT',
      productoId: String(productoId),
      cantidadDisponible: String(cantidadDisponible),
    });
  }

  /** Enviar notificación de actualización de retiro de fondos */
  async sendPayoutStatusNotification(deviceToken, { payoutId, status, amount }) {
    const title = status === 'COMPLETED' ? '💳 ¡Retiro de Fondos Aprobado!' : `💸 Solicitud de Retiro (${status})`;
    const body = `Tu solicitud de retiro #${payoutId} por \$${amount} COP se encuentra ${status}.`;

    return await this._sendNotification(deviceToken, title, body, {
      type: 'PAYOUT_STATUS_UPDATE',
      payoutId: String(payoutId),
      status,
    });
  }

  async _sendNotification(deviceToken, title, body, data = {}) {
    if (this.initialized && this.admin && deviceToken) {
      try {
        const message = {
          notification: { title, body },
          data,
          token: deviceToken,
        };
        const response = await this.admin.messaging().send(message);
        logger.info('✅ FCM Push Notification enviada exitosamente:', response);
        return { success: true, messageId: response };
      } catch (error) {
        logger.error('❌ Error enviando FCM Push Notification:', error.message);
        return { success: false, error: error.message };
      }
    } else {
      logger.info(`📲 [FCM SIMULATION] Push enviada a token "${deviceToken || 'MOCK_TOKEN'}": [${title}] ${body}`, data);
      return { success: true, simulated: true, title, body };
    }
  }
}

module.exports = new FCMNotificationService();
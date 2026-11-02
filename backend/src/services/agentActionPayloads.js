// backend/src/services/agentActionPayloads.js

/**
 * PATRÓN 1: Generador de Payloads de Acción Directa para UI (Flutter UI-Driven Agent)
 */
class AgentActionPayloads {
  /**
   * Crea una acción de navegación y llenado directo de formulario de agendamiento
   */
  createNavigateAndFillAction({ providerId, serviceId, serviceName, price, date, time }) {
    return {
      type: 'ACTION_PAYLOAD',
      action: 'NAVIGATE_AND_FILL',
      targetScreen: '/booking_checkout',
      payload: {
        providerId,
        serviceId,
        serviceName,
        price,
        date: date || new Date().toISOString().split('T')[0],
        time: time || '15:00',
        autoConfirmReady: false
      }
    };
  }

  /**
   * Crea una acción de redirección gráfica al Módulo de Ideas / Visajismo
   */
  createIdeasRedirectionAction(moduleKey) {
    return {
      type: 'ACTION_PAYLOAD',
      action: 'OPEN_MODULO_IDEAS',
      targetScreen: '/modulo_ideas',
      payload: {
        moduleKey, // e.g. 'skin-tone', 'eyebrow-visagism', 'nails-style'
        autoScanTrigger: false
      }
    };
  }

  /**
   * Crea una acción de aplicación de cupón o precio dinámico en checkout
   */
  createApplyPromoCheckoutAction({ promoCode, discountPercentage, providerId }) {
    return {
      type: 'ACTION_PAYLOAD',
      action: 'APPLY_PROMO_CHECKOUT',
      targetScreen: '/checkout',
      payload: {
        promoCode,
        discountPercentage,
        providerId
      }
    };
  }
}

module.exports = new AgentActionPayloads();

// backend/src/controllers/shortcutController.js
const hermesAgent = require('../services/agents/hermesAgent');
const agentActionPayloads = require('../services/agentActionPayloads');

/**
 * PATRÓN 3: Controlador de Atajos de Voz y Accesibilidad SO (Siri Shortcuts / Android App Actions)
 */
exports.handleQuickBookShortcut = async (req, res) => {
  const startTime = Date.now();

  try {
    const userId = req.user ? req.user.id : (req.body.userId || 1);
    const { category = 'uñas', latitude = 4.6097, longitude = -74.0817 } = req.body;

    // 1. Invocación directa ultrarrápida a HERMES para obtener la opción top en Bogotá
    const hermesResult = await hermesAgent.findNearbyServices({
      latitude,
      longitude,
      category,
      maxDistanceKm: 5
    });

    if (!hermesResult.services || hermesResult.services.length === 0) {
      return res.json({
        success: true,
        speechResponse: `No encontré espacios disponibles para ${category} cerca de tu ubicación.`,
        actionPayload: null
      });
    }

    const topMatch = hermesResult.services[0];

    // 2. Generar acción de navegación para Flutter
    const actionPayload = agentActionPayloads.createNavigateAndFillAction({
      providerId: topMatch.provider_id,
      serviceId: topMatch.service_id,
      serviceName: topMatch.name,
      price: topMatch.price,
      date: new Date().toISOString().split('T')[0],
      time: '15:00'
    });

    const executionTimeMs = Date.now() - startTime;

    res.json({
      success: true,
      executionTimeMs,
      speechResponse: `Encontré ${topMatch.name} en ${topMatch.business_name} por $${parseFloat(topMatch.price).toLocaleString('es-CO')} COP a ${topMatch.distance_km} km. ¿Quieres abrir la pantalla de pago?`,
      actionPayload
    });
  } catch (error) {
    console.error('❌ Error en handleQuickBookShortcut:', error);
    res.status(500).json({ error: 'Error procesando atajo de voz' });
  }
};

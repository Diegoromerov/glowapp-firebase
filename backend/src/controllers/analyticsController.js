// src/controllers/analyticsController.js
const { AnalyticsEvent } = require('../models');

// Log an analytics event (telemetry)
async function logEvent(req, res) {
  try {
    let items = [];
    if (req.body && Array.isArray(req.body.events)) {
      items = req.body.events;
    } else if (Array.isArray(req.body)) {
      items = req.body;
    } else if (req.body && typeof req.body === 'object') {
      items = [req.body];
    }

    if (items.length === 0) {
      return res.status(200).json({ success: true, count: 0 });
    }
    if (items.length > 50) return res.status(400).json({ error: 'batch_too_large', max_events: 50 });

    const validName = (value, regex) => typeof value === 'string' && regex.test(value) ? value : null;
    const records = items.map((item) => {
      const eventType = validName(item?.event_type, /^[A-Z][A-Z0-9_]{0,59}$/);
      const screen = validName(item?.screen_name, /^\/[A-Za-z0-9_./-]{1,100}$/);
      if (!eventType) return null;
      return {
        user_id: null,
        event_type: eventType,
        metadata: screen ? { screen_name: screen } : {},
        occurred_at: new Date(),
      };
    }).filter(Boolean);
    if (records.length === 0) return res.status(400).json({ error: 'no_valid_events' });

    await AnalyticsEvent.bulkCreate(records, { ignoreDuplicates: true });
    return res.status(201).json({ success: true, count: records.length });
  } catch (err) {
    console.error('Error logging analytics event:', err);
    return res.status(500).json({ error: 'telemetry_write_failed' });
  }
}

module.exports = { logEvent };


// GET /api/analytics/summary?days=7 — embudo observable.
//
// Devuelve dos cortes del mismo dato: por tipo de evento y por pantalla. Sin
// esto la telemetría se escribe y nadie la lee: el ítem 68 de la auditoría
// pedía justamente el consumidor, no el productor.
module.exports.summary = async (req, res) => {
  try {
    // `parseInt(...) || 7` convertía days=0 en 7: la ventana pedida se
    // ignoraba en silencio. Se distingue "no vino" de "vino un 0".
    const pedido = Number.parseInt(req.query.days, 10);
    const dias = Math.min(Math.max(Number.isFinite(pedido) ? pedido : 7, 1), 90);
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
    const { Op } = require('sequelize');
    const sequelize = AnalyticsEvent.sequelize;

    const porTipo = await AnalyticsEvent.findAll({
      attributes: ['event_type', [sequelize.fn('COUNT', sequelize.col('id')), 'total']],
      where: { occurred_at: { [Op.gte]: desde } },
      group: ['event_type'],
      order: [[sequelize.literal('total'), 'DESC']],
      raw: true,
    });

    const porPantalla = await AnalyticsEvent.findAll({
      attributes: [
        [sequelize.literal("metadata->>'screen_name'"), 'screen_name'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'total'],
      ],
      where: { occurred_at: { [Op.gte]: desde } },
      group: [sequelize.literal("metadata->>'screen_name'")],
      order: [[sequelize.literal('total'), 'DESC']],
      limit: 30,
      raw: true,
    });

    return res.json({
      success: true,
      days: dias,
      desde: desde.toISOString(),
      por_tipo: porTipo,
      por_pantalla: porPantalla,
    });
  } catch (err) {
    console.error('Error en resumen de analitica:', err);
    return res.status(500).json({ error: 'analytics_summary_failed' });
  }
};

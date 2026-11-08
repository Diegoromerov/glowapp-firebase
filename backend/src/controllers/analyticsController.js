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

const express = require('express');
const { wrapRouterAsync } = require('../utils/expressAsync');
const { pool } = require('../config/db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();
const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

router.get('/telemetry/summary', authMiddleware, adminMiddleware, async (req, res) => {
  const from = parseDate(req.query.from) || new Date(Date.now() - 30 * 86400000).toISOString();
  const to = parseDate(req.query.to) || new Date().toISOString();
  if ((req.query.from && !parseDate(req.query.from)) || (req.query.to && !parseDate(req.query.to))) {
    return res.status(400).json({ error: 'invalid_date', message: 'Usa fechas ISO-8601 válidas.' });
  }
  if (new Date(from) > new Date(to) || new Date(to).getTime() - new Date(from).getTime() > 366 * 86400000) {
    return res.status(400).json({ error: 'invalid_range', message: 'Rango inválido; máximo 366 días.' });
  }
  try {
    const [total, byType, byScreen, daily] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM analytics_events WHERE occurred_at >= $1 AND occurred_at <= $2`, [from, to]),
      pool.query(`SELECT event_type, COUNT(*)::int AS count FROM analytics_events WHERE occurred_at >= $1 AND occurred_at <= $2 GROUP BY event_type ORDER BY count DESC`, [from, to]),
      pool.query(`SELECT metadata->>'screen_name' AS screen_name, COUNT(*)::int AS count FROM analytics_events WHERE occurred_at >= $1 AND occurred_at <= $2 AND metadata ? 'screen_name' GROUP BY 1 ORDER BY count DESC`, [from, to]),
      pool.query(`SELECT date_trunc('day', occurred_at)::date AS day, COUNT(*)::int AS count FROM analytics_events WHERE occurred_at >= $1 AND occurred_at <= $2 GROUP BY 1 ORDER BY 1`, [from, to]),
    ]);
    return res.json({ success: true, data: {
      generated_at: new Date().toISOString(), period: { from, to }, total_events: total.rows[0].count,
      by_event_type: byType.rows, by_screen: byScreen.rows, daily: daily.rows,
      privacy: { user_identifiers_stored: false, raw_event_access_exposed: false },
    } });
  } catch (error) {
    console.error('GET /api/admin/telemetry/summary failed:', error.message);
    return res.status(500).json({ error: 'telemetry_unavailable' });
  }
});

wrapRouterAsync(router);
module.exports = router;

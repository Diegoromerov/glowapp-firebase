// src/controllers/xpLogController.js
const { XpLog } = require('../models');

// Auditoría 2026-09-22 (B19): el esquema real de `xp_logs` es
// (user_id, xp_amount, reason, metadata) — tanto el DDL de 023 como el modelo
// Sequelize. El controlador hablaba de `points`/`description`, columnas que no
// existen: Sequelize descartaba los campos y el INSERT fallaba por NOT NULL en
// xp_amount, y `SUM(points)` reventaba en PostgreSQL.

async function getLogs(req, res) {
  try {
    const logs = await XpLog.findAll({
      where: { user_id: req.user.id },
      order: [['created_at', 'DESC']],
    });
    return res.json(logs);
  } catch (err) {
    console.error('Error fetching XP logs:', err);
    return res.status(500).json({ error: 'Error fetching XP logs.' });
  }
}

// Create a new XP log entry
async function createLog(req, res) {
  try {
    const xpAmount = req.body ? req.body.xp_amount : undefined;
    if (!Number.isInteger(xpAmount)) {
      return res.status(400).json({ error: 'El campo "xp_amount" debe ser un entero.' });
    }

    const log = await XpLog.create({
      user_id: req.user.id,
      xp_amount: xpAmount,
      reason: (req.body.reason || null),
      metadata: (req.body.metadata || null),
    });
    return res.status(201).json(log);
  } catch (err) {
    console.error('Error creating XP log:', err);
    return res.status(500).json({ error: 'Error creating XP log.' });
  }
}

// POST /api/xp-logs/convert-cashback — DESHABILITADO (D-03, aprobada 2026-11-12)
//
// Convertía XP en `perfiles_prestador.saldo_disponible`: saldo retirable, es
// decir dinero real por una puerta lateral, contra la regla del Director de no
// acreditar en Wompi. El canje válido es el descuento en GlowShop sobre el libro
// de puntos (`points_lots`, migración 142).
//
// Se responde 410 Gone, no 404: la ruta existió, se usó y ya no está. Devolver
// 404 haría creer que la URL está mal escrita. El historial de `xp_logs` no se
// toca: los asientos viejos siguen ahí y siguen sumando XP de estado.
function canjeDeshabilitado(_req, res) {
  return res.status(410).json({
    error: 'CANJE_CASHBACK_DESHABILITADO',
    message:
      'El canje de XP por cashback ya no está disponible. Tus puntos se canjean como descuento en GlowShop.',
    saldo_puntos: '/api/rewards/points',
  });
}

module.exports = { getLogs, createLog, canjeDeshabilitado };

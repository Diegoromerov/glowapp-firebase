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

// Convert XP points to Wallet Cashback balance (500 XP = $5.000 COP)
async function convertXpToCashback(req, res) {
  const { pool } = require('../config/db');
  const userId = req.user.id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Saldo de XP del usuario
    const xpRes = await client.query(
      'SELECT COALESCE(SUM(xp_amount), 0) as total_xp FROM xp_logs WHERE user_id = $1',
      [userId]
    );
    const totalXp = parseInt(xpRes.rows[0].total_xp || '0', 10);

    if (totalXp < 500) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Requieres al menos 500 XP para canjear Cashback. Tu saldo actual es de ${totalXp} XP.`,
      });
    }

    const blocksToConvert = Math.floor(totalXp / 500);
    const xpToDeduct = blocksToConvert * 500;
    const cashbackAmount = blocksToConvert * 5000;

    // Descontar XP del historial (asiento negativo)
    await client.query(
      `INSERT INTO xp_logs (user_id, xp_amount, reason, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [userId, -xpToDeduct, `Canje de ${xpToDeduct} XP por $${cashbackAmount} COP en Cashback`]
    );

    // Abonar saldo en wallet del prestador/cliente
    await client.query(
      `UPDATE perfiles_prestador SET saldo_disponible = COALESCE(saldo_disponible, 0) + $1 WHERE id = $2`,
      [cashbackAmount, userId]
    );

    await client.query('COMMIT');

    console.log(`🎉 [CASHBACK GAMIFICADO] Usuario ID ${userId} canjeó ${xpToDeduct} XP por $${cashbackAmount} COP en Billetera.`);

    return res.json({
      success: true,
      message: `¡Canje exitoso! Se han acreditado $${cashbackAmount} COP a tu Billetera GlowApp.`,
      xp_deducted: xpToDeduct,
      cashback_credited: cashbackAmount,
      remaining_xp: totalXp - xpToDeduct,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error converting XP to cashback:', err);
    return res.status(500).json({ error: 'Error al procesar el canje de XP por Cashback.' });
  } finally {
    client.release();
  }
}

module.exports = { getLogs, createLog, convertXpToCashback };

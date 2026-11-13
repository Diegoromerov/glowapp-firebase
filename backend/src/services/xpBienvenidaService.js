/**
 * XP de bienvenida al crear la cuenta.
 *
 * 100 XP no cambian el nivel (Pétalo empieza en 300), pero mueven la barra un
 * tercio y convierten el registro en el primer paso de una escalera visible.
 * El XP no cuesta dinero: es estado, no saldo.
 *
 * Idempotente por consulta, no por índice: `xp_logs` no tiene clave única y no
 * vale la pena una migración para esto. El INSERT sólo ocurre si esa cuenta no
 * tiene ya su asiento de bienvenida.
 */
const { pool: poolPorDefecto } = require('../config/db');
const xpService = require('./xpService');

const XP_BIENVENIDA = 100;
const MOTIVO = 'registro:bienvenida';

async function acreditarXpBienvenida({ userId, cliente = poolPorDefecto } = {}) {
  if (!userId) return { acreditado: false, motivo: 'SIN_USUARIO' };

  try {
    // Idempotencia: una sola bienvenida por cuenta.
    const ya = await cliente.query(
      `SELECT 1 FROM xp_logs WHERE user_id = $1 AND reason = $2 LIMIT 1`,
      [userId, MOTIVO]
    );
    if (ya.rowCount > 0) return { acreditado: false, motivo: 'YA_ACREDITADO' };

    // Pasa por el punto único: si con estos 100 XP cambia de nivel, se avisa.
    await xpService.acreditarXp({
      userId,
      xp: XP_BIENVENIDA,
      motivo: MOTIVO,
      cliente,
    });
    return { acreditado: true, puntos: XP_BIENVENIDA };
  } catch (e) {
    console.warn('⚠️ No se pudo acreditar el XP de bienvenida:', e.message);
    return { acreditado: false, motivo: 'ERROR' };
  }
}

module.exports = { acreditarXpBienvenida, XP_BIENVENIDA, MOTIVO };

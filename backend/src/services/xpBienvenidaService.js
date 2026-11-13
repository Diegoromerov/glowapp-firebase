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

const XP_BIENVENIDA = 100;
const MOTIVO = 'registro:bienvenida';

async function acreditarXpBienvenida({ userId, cliente = poolPorDefecto } = {}) {
  if (!userId) return { acreditado: false, motivo: 'SIN_USUARIO' };

  try {
    const r = await cliente.query(
      `INSERT INTO xp_logs (user_id, xp_amount, reason, metadata)
       SELECT $1, $2, $3, '{"fuente":"registro"}'::jsonb
        WHERE NOT EXISTS (
          SELECT 1 FROM xp_logs WHERE user_id = $1 AND reason = $3
        )
       RETURNING id`,
      [userId, XP_BIENVENIDA, MOTIVO]
    );
    return { acreditado: Boolean(r && r.rowCount > 0), puntos: XP_BIENVENIDA };
  } catch (e) {
    // Nunca rompe el registro: entrar importa más que los 100 XP.
    console.warn('⚠️ No se pudo acreditar el XP de bienvenida:', e.message);
    return { acreditado: false, motivo: 'ERROR' };
  }
}

module.exports = { acreditarXpBienvenida, XP_BIENVENIDA, MOTIVO };

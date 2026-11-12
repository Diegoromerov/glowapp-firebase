// src/services/referralService.js
//
// Atribución del programa de referidos. Antes existía el código (`usuarios.
// referral_code`) y el mensaje con el crédito, pero nada registraba quién invitó
// a quién: el registro ignoraba `?ref=` y no había tabla de conversiones.
//
// Las dos funciones son best-effort: que falle la atribución no puede tumbar un
// registro ni una reserva. Devolver `false` es información, no un error.
const { pool: poolPorDefecto } = require('../config/db');

/// Marca al usuario nuevo como invitado por el dueño de [codigo].
/// Devuelve `true` si el código existía y la fila quedó atribuida.
async function atribuirInvitacion({ nuevoUsuarioId, codigo, pool = poolPorDefecto }) {
  const limpio = String(codigo || '').trim().toUpperCase();
  if (!limpio || !nuevoUsuarioId) return false;

  // `r.id <> usuarios.id` evita que alguien se invite a sí mismo.
  const res = await pool.query(
    `UPDATE usuarios u
        SET referred_by_user_id = r.id
       FROM usuarios r
      WHERE u.id = $1
        AND r.referral_code = $2
        AND r.id <> u.id
        AND u.referred_by_user_id IS NULL`,
    [nuevoUsuarioId, limpio]
  );
  return (res.rowCount || 0) > 0;
}

/// Puntos que recibe el referidor por una compra efectiva del invitado.
///
/// 500 puntos = $5.000 COP, con la regla que ya usa el canje (500 XP = $5.000).
/// NO se acredita a Wompi: entra al fondo de puntos, canjeable como descuento en
/// productos.
const PUNTOS_POR_COMPRA_REFERIDA = 500;

/// Acredita el premio cuando el invitado PAGA un pedido de producto.
///
/// Regla del Director (2026-11-11): ni por la mera recomendación ni por reservar;
/// sólo por una compra efectiva de cualquier producto, y el premio entra al fondo
/// de puntos (canjeable como descuento en productos), nunca a Wompi.
///
/// El premio se acredita al INVITADO, que es a quien el mensaje de invitación le
/// promete el beneficio («... cuando hagas tu primera compra»). El referidor queda
/// registrado en `referral_conversions` para medir; si el Director prefiere que
/// cobre el referidor, es cambiar `[referidorId, ...]` por `[inviteeId, ...]` en el
/// INSERT de xp_logs.
///
/// Idempotente: UNIQUE(invitee_user_id) y UNIQUE(order_id) hacen que un pedido
/// acredite una sola vez.
///
/// Devuelve `{ acreditado, puntos, referidorId }`. Nunca lanza: un fallo aquí no
/// puede tumbar un cobro ya confirmado.
async function acreditarCompraReferida({ inviteeId, orderId, pool = poolPorDefecto }) {
  const sinCredito = { acreditado: false, puntos: 0, referidorId: null };
  if (!inviteeId) return sinCredito;

  try {
    const invitado = await pool.query(
      `SELECT referred_by_user_id FROM usuarios WHERE id = $1 AND referred_by_user_id IS NOT NULL`,
      [inviteeId]
    );
    const referidorId = invitado.rows[0] && invitado.rows[0].referred_by_user_id;
    if (!referidorId) return sinCredito;

    const ins = await pool.query(
      `INSERT INTO referral_conversions
         (referrer_user_id, invitee_user_id, order_id, points_awarded)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (invitee_user_id) DO NOTHING
       RETURNING id`,
      [referidorId, inviteeId, orderId || null, PUNTOS_POR_COMPRA_REFERIDA]
    );
    if ((ins.rowCount || 0) === 0) return { ...sinCredito, referidorId };

    // El premio va al fondo de puntos del referidor (xp_logs), de donde se canjea
    // como descuento en productos. No se toca Wompi.
    await pool.query(
      `INSERT INTO xp_logs (user_id, xp_amount, reason) VALUES ($1, $2, $3)`,
      [inviteeId, PUNTOS_POR_COMPRA_REFERIDA, 'referido:compra']
    );

    await pool.query(
      `UPDATE usuarios SET referral_converted_at = NOW()
        WHERE id = $1 AND referral_converted_at IS NULL`,
      [inviteeId]
    );

    return { acreditado: true, puntos: PUNTOS_POR_COMPRA_REFERIDA, referidorId };
  } catch (error) {
    console.error('⚠️ [REFERIDOS] No se pudo acreditar la compra referida:', error.message);
    return sinCredito;
  }
}

module.exports = { atribuirInvitacion, acreditarCompraReferida, PUNTOS_POR_COMPRA_REFERIDA };

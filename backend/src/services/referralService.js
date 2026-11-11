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

/// Registra la conversión del invitado en su primera reserva.
///
/// UNIQUE(invitee_user_id) en la tabla hace que la segunda reserva no cuente dos
/// veces; aquí se usa ON CONFLICT DO NOTHING para que sea idempotente sin
/// depender de leer antes.
async function registrarConversion({ inviteeId, bookingId = null, pool = poolPorDefecto }) {
  if (!inviteeId) return false;

  const invitado = await pool.query(
    `SELECT referred_by_user_id FROM usuarios WHERE id = $1 AND referred_by_user_id IS NOT NULL`,
    [inviteeId]
  );
  const referidor = invitado.rows[0] && invitado.rows[0].referred_by_user_id;
  if (!referidor) return false;

  const ins = await pool.query(
    `INSERT INTO referral_conversions (referrer_user_id, invitee_user_id, booking_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (invitee_user_id) DO NOTHING
     RETURNING id`,
    [referidor, inviteeId, bookingId]
  );

  if ((ins.rowCount || 0) > 0) {
    // Marca de tiempo para poder medir «invitado que nunca reservó».
    await pool.query(
      `UPDATE usuarios SET referral_converted_at = NOW()
        WHERE id = $1 AND referral_converted_at IS NULL`,
      [inviteeId]
    );
    return true;
  }
  return false;
}

module.exports = { atribuirInvitacion, registrarConversion };

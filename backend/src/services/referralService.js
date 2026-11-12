// src/services/referralService.js
//
// Atribución del programa de referidos. Antes existía el código (`usuarios.
// referral_code`) y el mensaje con el crédito, pero nada registraba quién invitó
// a quién: el registro ignoraba `?ref=` y no había tabla de conversiones.
//
// Las dos funciones son best-effort: que falle la atribución no puede tumbar un
// registro ni una reserva. Devolver `false` es información, no un error.
//
// Desde la migración 142 el premio NO se escribe en `xp_logs`: va al libro de
// puntos canjeables (`pointsService`), con lote y vencimiento. `xp_logs` queda
// para el XP de estado y no se le añaden asientos de dinero.
const { pool: poolPorDefecto } = require('../config/db');
const { MINIMO_COMPRA_PREMIO } = require('../config/programaPuntos');
const pointsService = require('./pointsService');

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
/// 500 puntos = $5.000 COP, con la regla ya vigente del canje (1 punto = $10).
/// NO se acredita a Wompi: entra al fondo de puntos, canjeable como descuento en
/// productos.
const PUNTOS_POR_COMPRA_REFERIDA = 500;

/// Puntos de bienvenida para el invitado, cuando hace su primera compra pagada.
/// Decisión D-02 (aprobada 2026-11-12): el programa deja de ser de un solo lado.
const PUNTOS_BIENVENIDA_REFERIDA = 100;

/// Tope de conversiones premiadas por referente en un mes calendario (R-05).
/// La conversión que pasa el tope se registra igual, con 0 puntos y estado
/// `TOPE_MENSUAL`: perder la traza sería peor que no pagar.
const TOPE_CONVERSIONES_MES = 10;

/// Acredita el premio cuando el invitado PAGA un pedido de producto.
///
/// Regla del Director (2026-11-11): ni por la mera recomendación ni por reservar;
/// sólo por una compra efectiva de cualquier producto, y el premio entra al fondo
/// de puntos (canjeable como descuento en productos), nunca a Wompi.
///
/// El premio grande es del REFERENTE (quien invita), que es el estímulo para que
/// siga invitando a su grupo. El INVITADO recibe 100 puntos de bienvenida en la
/// misma compra (D-02): simbólico, pero existe, y es lo que hace que acepte el
/// código de una amiga en vez de ignorarlo.
///
/// Idempotente por partida doble:
///   - `UNIQUE(invitee_user_id)` en `referral_conversions`: un invitado convierte
///     una sola vez en su vida;
///   - `UNIQUE(origen, referencia_id)` en `points_lots`: un pedido acredita una
///     sola vez, aunque el webhook llegue repetido.
///
/// Si la conversión se registra y la acreditación falla, se deshace la conversión
/// para que un reintento pueda completarla: no se deja media verdad en la base.
///
/// Devuelve `{ acreditado, puntos, referidorId }`. Nunca lanza: un fallo aquí no
/// puede tumbar un cobro ya confirmado.
async function acreditarCompraReferida({
  inviteeId,
  orderId,
  totalProductos = null,
  pool = poolPorDefecto,
}) {
  const sinCredito = { acreditado: false, puntos: 0, referidorId: null };
  if (!inviteeId) return sinCredito;

  let conversionId = null;

  try {
    const invitado = await pool.query(
      `SELECT referred_by_user_id FROM usuarios WHERE id = $1 AND referred_by_user_id IS NOT NULL`,
      [inviteeId]
    );
    const referidorId = invitado.rows[0] && invitado.rows[0].referred_by_user_id;
    if (!referidorId) return sinCredito;

    // Compra mínima (R-06): un pedido por debajo del umbral no convierte, pero
    // tampoco se registra. Así la invitada conserva su única conversión para una
    // compra que sí valga la pena, en vez de perderla con el producto más barato.
    if (totalProductos !== null && Number(totalProductos) < MINIMO_COMPRA_PREMIO) {
      return { ...sinCredito, referidorId, motivo: 'COMPRA_BAJO_MINIMO' };
    }

    // El tope mensual (R-05) se resuelve dentro del propio INSERT: contar antes y
    // decidir después deja una ventana donde dos conversiones simultáneas pasan
    // las dos. La conversión que supera el tope se registra con 0 puntos y su
    // motivo, para no perder la traza.
    const ins = await pool.query(
      `INSERT INTO referral_conversions
         (referrer_user_id, invitee_user_id, order_id, points_awarded, estado, motivo_revision)
       SELECT $1, $2, $3,
              CASE WHEN c.n >= $5 THEN 0 ELSE $4 END,
              CASE WHEN c.n >= $5 THEN 'TOPE_MENSUAL' ELSE 'ACREDITADA' END,
              CASE WHEN c.n >= $5 THEN 'Superó el tope mensual de premios' ELSE NULL END
         FROM (
           SELECT COUNT(*)::int AS n
             FROM referral_conversions
            WHERE referrer_user_id = $1
              AND estado = 'ACREDITADA'
              AND created_at >= (date_trunc('month', NOW() AT TIME ZONE 'America/Bogota')
                                 AT TIME ZONE 'America/Bogota')
         ) AS c
       ON CONFLICT (invitee_user_id) DO NOTHING
       RETURNING id, estado, points_awarded`,
      [referidorId, inviteeId, orderId || null, PUNTOS_POR_COMPRA_REFERIDA, TOPE_CONVERSIONES_MES]
    );
    if ((ins.rowCount || 0) === 0) return { ...sinCredito, referidorId };
    const conversion = ins.rows[0];
    conversionId = conversion.id;

    if (conversion.estado === 'TOPE_MENSUAL') {
      // La invitada queda marcada igual: ya convirtió, y eso no se repite. Lo que
      // no hay es premio.
      await pool.query(
        `UPDATE usuarios SET referral_converted_at = NOW()
          WHERE id = $1 AND referral_converted_at IS NULL`,
        [inviteeId]
      );
      return { acreditado: false, puntos: 0, referidorId, motivo: 'TOPE_MENSUAL' };
    }

    // Premio del referente: 500 puntos al fondo canjeable.
    const premio = await pointsService.acreditar({
      userId: referidorId,
      puntos: PUNTOS_POR_COMPRA_REFERIDA,
      origen: 'referido:compra',
      referenciaId: orderId ? String(orderId) : null,
      motivo: 'Premio por la compra de tu invitada',
      cliente: pool,
    });

    // Bienvenida del invitado: 100 puntos, una sola vez por persona.
    await pointsService.acreditar({
      userId: inviteeId,
      puntos: PUNTOS_BIENVENIDA_REFERIDA,
      origen: 'referido:bienvenida',
      referenciaId: String(inviteeId),
      motivo: 'Bienvenida: tu primera compra con código de invitación',
      cliente: pool,
    });

    await pool.query(
      `UPDATE usuarios SET referral_converted_at = NOW()
        WHERE id = $1 AND referral_converted_at IS NULL`,
      [inviteeId]
    );

    return {
      acreditado: Boolean(premio.acreditado),
      puntos: premio.acreditado ? PUNTOS_POR_COMPRA_REFERIDA : 0,
      referidorId,
    };
  } catch (error) {
    // Media conversión es peor que ninguna: si no se pudo premiar, se retira el
    // registro para que el próximo intento lo complete.
    if (conversionId) {
      try {
        await pool.query('DELETE FROM referral_conversions WHERE id = $1', [conversionId]);
      } catch (limpiezaError) {
        console.error(
          '⚠️ [REFERIDOS] No se pudo deshacer la conversión tras el fallo:',
          limpiezaError.message
        );
      }
    }
    console.error('⚠️ [REFERIDOS] No se pudo acreditar la compra referida:', error.message);
    return sinCredito;
  }
}

module.exports = {
  atribuirInvitacion,
  acreditarCompraReferida,
  PUNTOS_POR_COMPRA_REFERIDA,
  PUNTOS_BIENVENIDA_REFERIDA,
  TOPE_CONVERSIONES_MES,
};

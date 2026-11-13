/**
 * XP: punto único de escritura y aviso de subida de nivel.
 *
 * El nivel se calcula al vuelo desde `xp_logs`, así que no hay un «evento» de
 * subida que escuchar. La solución es que TODA acreditación de XP pase por aquí:
 * se calcula el nivel antes y después del asiento y, si cambió, se avisa.
 *
 * El aviso es best-effort y con memoria: `ultimo_nivel_notificado` evita repetir
 * el mismo mensaje y permite que el job diario detecte lo que se escriba por
 * fuera de este camino.
 */
const { pool: poolPorDefecto } = require('../config/db');
const { nivelDeXp } = require('../config/cuotasIA');
const fcm = require('./fcmNotificationService');
const emailService = require('./email.service');

/** Qué gana la usuaria en cada nivel. Genérico aquí, concreto en el aviso. */
const BENEFICIOS = {
  petalo: 'un análisis con IA extra cada mes y XP ×2 un día al mes',
  oro: '3 análisis con IA extra cada mes y 24 h de prioridad en las reservas',
  diamante:
    '6 análisis con IA extra cada mes, prioridad en las reservas y acceso anticipado a lanzamientos',
};

async function xpTotal({ userId, cliente }) {
  const r = await cliente.query(
    `SELECT COALESCE(SUM(xp_amount), 0)::int AS total
       FROM xp_logs WHERE user_id = $1 AND xp_amount > 0`,
    [userId]
  );
  return Number((r.rows[0] && r.rows[0].total) || 0);
}

async function datosDeContacto({ userId, cliente }) {
  const r = await cliente.query(
    `SELECT nombre, email, fcm_token, ultimo_nivel_notificado
       FROM usuarios WHERE id = $1`,
    [userId]
  );
  return r.rows[0] || null;
}

/**
 * Acredita XP y, si con eso cambia de nivel, avisa por push y por correo.
 *
 * @returns {Promise<{xp:number, nivel:object, avisado:boolean}>}
 */
async function acreditarXp({
  userId,
  xp,
  motivo = 'xp',
  cliente = poolPorDefecto,
  notificar = true,
} = {}) {
  if (!userId || !xp) return { xp: 0, nivel: nivelDeXp(0), avisado: false };

  const antes = await xpTotal({ userId, cliente });

  await cliente.query(
    `INSERT INTO xp_logs (user_id, xp_amount, reason) VALUES ($1, $2, $3)`,
    [userId, xp, motivo]
  );

  const despues = antes + Number(xp);
  const nivelAntes = nivelDeXp(antes);
  const nivelDespues = nivelDeXp(despues);

  let avisado = false;
  if (notificar && nivelDespues.clave !== nivelAntes.clave) {
    avisado = await avisarNivel({ userId, nivel: nivelDespues, cliente });
  }

  return { xp: despues, nivel: nivelDespues, avisado };
}

/**
 * Avisa de una subida de nivel, una sola vez por nivel.
 *
 * Push y correo son independientes: si falla uno, el otro sale igual. Y si no
 * hay token ni correo, no se rompe nada — el aviso es un extra, no un requisito.
 */
async function avisarNivel({ userId, nivel, cliente = poolPorDefecto }) {
  const u = await datosDeContacto({ userId, cliente });
  if (!u) return false;
  if (u.ultimo_nivel_notificado === nivel.clave) return false;

  const beneficio = BENEFICIOS[nivel.clave] || 'más beneficios en tu Club';
  const titulo = `Subiste a ${nivel.nombre}`;
  const cuerpo = `Ahora tienes ${beneficio}. Todo está en tu Club Glow Luxe.`;

  if (u.fcm_token) {
    try {
      await fcm.sendPushNotification(u.fcm_token, {
        title: titulo,
        body: cuerpo,
        data: { tipo: 'nivel', nivel: nivel.clave },
      });
    } catch (e) {
      console.warn('⚠️ Push de nivel falló:', e.message);
    }
  }

  if (u.email && !String(u.email).includes('@glowapp.deleted')) {
    try {
      await emailService.sendEmail({
        to: u.email,
        subject: titulo,
        htmlText: `<p>Hola${u.nombre ? ' ' + u.nombre : ''},</p>
          <p><strong>${titulo}</strong>. ${cuerpo}</p>
          <p>Entra a la app y mira lo que acabas de desbloquear.</p>`,
        plainText: `${titulo}. ${cuerpo}`,
      });
    } catch (e) {
      console.warn('⚠️ Correo de nivel falló:', e.message);
    }
  }

  await cliente.query(
    `UPDATE usuarios SET ultimo_nivel_notificado = $1 WHERE id = $2`,
    [nivel.clave, userId]
  );
  return true;
}

module.exports = { acreditarXp, avisarNivel, xpTotal, BENEFICIOS };

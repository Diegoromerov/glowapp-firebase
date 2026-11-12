// src/jobs/puntosVencimiento.js
//
// Aviso de vencimiento de puntos.
//
// Los puntos caducan a los 12 meses. Un vencimiento silencioso es la peor forma
// de perder un beneficio: la usuaria lo descubre cuando ya no está. Este job
// avisa una sola vez por lote, cuando le quedan 30 días o menos, y marca el lote
// para no repetir el aviso todos los días.
//
// El canal es FCM (`fcmNotificationService`), el mismo que ya usa el resto del
// backend. Si la usuaria no tiene token, el lote se marca igual: no tiene sentido
// reintentar un aviso que no puede llegar, y el saldo sigue visible en la
// pantalla de Recompensas.
const { pool } = require('../config/db');
const fcm = require('../services/fcmNotificationService');

const DIAS_DE_AVISO = 30;
const LOTE_MAXIMO = 500;

function formatearFecha(valor) {
  try {
    return new Intl.DateTimeFormat('es-CO', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone: 'America/Bogota',
    }).format(new Date(valor));
  } catch (_) {
    return String(valor).slice(0, 10);
  }
}

async function avisarVencimientoPuntos({ cliente = pool, notificador = fcm } = {}) {
  const pendientes = await cliente.query(
    `SELECT l.id, l.user_id, l.puntos_restantes, l.vence_en, u.fcm_token
       FROM points_lots l
       JOIN usuarios u ON u.id = l.user_id
      WHERE l.puntos_restantes > 0
        AND l.aviso_vencimiento_en IS NULL
        AND l.vence_en > NOW()
        AND l.vence_en <= NOW() + INTERVAL '30 days'
      ORDER BY l.vence_en ASC
      LIMIT $1`,
    [LOTE_MAXIMO]
  );

  let enviados = 0;
  let sinToken = 0;

  for (const lote of pendientes.rows || []) {
    const puntos = Number(lote.puntos_restantes);
    const vence = formatearFecha(lote.vence_en);

    if (lote.fcm_token && notificador && typeof notificador.sendPushNotification === 'function') {
      try {
        await notificador.sendPushNotification(lote.fcm_token, {
          title: 'Tus puntos están por vencer',
          body: `Tienes ${puntos} puntos que vencen el ${vence}. Úsalos como descuento en GlowShop.`,
          data: { tipo: 'puntos_vencimiento', lote: String(lote.id) },
        });
        enviados += 1;
      } catch (err) {
        console.error(`⏳ [PUNTOS] No se pudo avisar el lote ${lote.id}:`, err.message);
        continue; // sin marca: se reintenta en la próxima pasada
      }
    } else {
      sinToken += 1;
    }

    await cliente.query(
      `UPDATE points_lots SET aviso_vencimiento_en = NOW()
        WHERE id = $1 AND aviso_vencimiento_en IS NULL`,
      [lote.id]
    );
  }

  console.log(
    `⏳ [PUNTOS] Avisos de vencimiento: ${enviados} enviados, ${sinToken} sin token, ` +
      `${(pendientes.rows || []).length} lotes revisados`
  );

  return { revisados: (pendientes.rows || []).length, enviados, sinToken };
}

module.exports = { avisarVencimientoPuntos, DIAS_DE_AVISO };

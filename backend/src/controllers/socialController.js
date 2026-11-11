// src/controllers/socialController.js
//
// Registro de compartires y entrega real de XP.
//
// La tabla `social_shares_log` ya existía (migración 008) y la ruta existía
// escrita dentro de `index.js`, pero esa versión no escribía en `xp_logs`: el
// teléfono mostraba «+50 XP» y el saldo del usuario no cambiaba. Tampoco era
// idempotente y su CHECK de `platform` no admitía la hoja del sistema, que es el
// caso más común (compartir por WhatsApp o correo).
const { pool } = require('../config/db');

const XP_POR_COMPARTIR = 50;

// La hoja de compartir del sistema es el caso general: el usuario elige
// WhatsApp, correo, Telegram… Se registra como SISTEMA (migración 138 amplía el
// CHECK de la tabla).
const PLATAFORMAS = ['TIKTOK', 'INSTAGRAM', 'FACEBOOK', 'WHATSAPP', 'SISTEMA'];

// Deben coincidir con el CHECK de `social_shares_log.content_type`: si se manda
// otro valor, el INSERT falla y el usuario ve un 500 sin explicación.
const TIPOS = ['AI_COLORIMETRY', 'VTO_LOOK', 'ACADEMY_CERT', 'PROVIDER_PROFILE', 'PRODUCT'];

async function logShare(req, res) {
  const userId = req.user && req.user.id;
  if (!userId) {
    return res.status(401).json({ success: false, error: 'No autenticado' });
  }

  const platform = String(req.body.platform || '').toUpperCase();
  const contentType = String(req.body.content_type || '').toUpperCase();
  const referencia = req.body.share_reference_id
    ? String(req.body.share_reference_id).slice(0, 255)
    : null;

  if (!PLATAFORMAS.includes(platform)) {
    return res.status(400).json({
      success: false,
      error: `platform debe ser una de: ${PLATAFORMAS.join(', ')}`,
    });
  }
  if (!TIPOS.includes(contentType)) {
    return res.status(400).json({
      success: false,
      error: `content_type debe ser uno de: ${TIPOS.join(', ')}`,
    });
  }

  try {
    // El índice único (user_id, content_type, referencia, día) impide que el XP
    // se infle recargando el botón: el segundo intento del día no inserta nada.
    const insert = await pool.query(
      `INSERT INTO social_shares_log
         (user_id, platform, content_type, share_reference_id, reward_granted,
          points_awarded, dia)
       VALUES ($1, $2, $3, $4, TRUE, 0, (NOW() AT TIME ZONE 'utc')::date)
       ON CONFLICT (user_id, content_type, COALESCE(share_reference_id, ''), dia)
       DO NOTHING
       RETURNING id`,
      [userId, platform, contentType, referencia]
    );

    if (insert.rowCount === 0) {
      return res.status(200).json({
        success: true,
        duplicate: true,
        xp_awarded: 0,
        message: 'Este contenido ya se compartió hoy; el XP se otorga una vez por día.',
      });
    }

    await pool.query(
      `INSERT INTO xp_logs (user_id, xp_amount, reason) VALUES ($1, $2, $3)`,
      [userId, XP_POR_COMPARTIR, `share:${contentType}`]
    );

    await pool.query(
      `UPDATE social_shares_log SET points_awarded = $1 WHERE id = $2`,
      [XP_POR_COMPARTIR, insert.rows[0].id]
    );

    return res.status(201).json({
      success: true,
      duplicate: false,
      xp_awarded: XP_POR_COMPARTIR,
      message: `¡Compartido! +${XP_POR_COMPARTIR} XP`,
    });
  } catch (error) {
    console.error('❌ [SOCIAL] Error registrando compartir:', error.message);
    return res.status(500).json({ success: false, error: 'No se pudo registrar el compartir' });
  }
}

module.exports = { logShare, PLATAFORMAS, TIPOS, XP_POR_COMPARTIR };

// src/controllers/rewardsAdminController.js
//
// Reporte de gestión del programa de puntos.
//
// Los puntos emitidos y no canjeados son un pasivo: una obligación de dar
// descuento sobre el catálogo propio. Sin estas cuatro cifras —emitido, canjeado,
// vencido y vivo— el programa crece a ciegas y nadie puede provisionarlo.
const { pool } = require('../config/db');
const { VALOR_PUNTO_COP } = require('../config/programaPuntos');
const pointsService = require('../services/pointsService');
const { PUNTOS_POR_COMPRA_REFERIDA } = require('../services/referralService');
const { maskEmail } = require('../utils/piiSanitizer');

const CONSULTA = `
  WITH periodo AS (
    SELECT date_trunc('month', NOW() AT TIME ZONE 'America/Bogota')
             AT TIME ZONE 'America/Bogota' AS ini
  )
  SELECT
    (SELECT COALESCE(SUM(l.puntos), 0)::int
       FROM points_lots l, periodo p WHERE l.creado_en >= p.ini)          AS emitidos_mes,
    (SELECT COALESCE(SUM(l.puntos), 0)::int FROM points_lots l)           AS emitidos_total,
    (SELECT COALESCE(SUM(l.puntos_restantes), 0)::int
       FROM points_lots l
      WHERE l.vence_en > NOW() AND l.puntos_restantes > 0)               AS vivos,
    (SELECT COALESCE(SUM(l.puntos_restantes), 0)::int
       FROM points_lots l
      WHERE l.vence_en <= NOW() AND l.puntos_restantes > 0)              AS vencidos,
    (SELECT COALESCE(SUM(m.puntos), 0)::int
       FROM points_movements m, periodo p
      WHERE m.tipo = 'consumo' AND m.creado_en >= p.ini)                 AS canjeados_mes,
    (SELECT COALESCE(SUM(m.puntos), 0)::int
       FROM points_movements m WHERE m.tipo = 'consumo')                 AS canjeados_total,
    (SELECT COALESCE(SUM(m.puntos), 0)::int
       FROM points_movements m WHERE m.tipo = 'compromiso')              AS en_espera_movimientos,
    (SELECT COUNT(*)::int
       FROM points_lots l
      WHERE l.aviso_vencimiento_en IS NOT NULL
        AND l.vence_en > NOW() AND l.puntos_restantes > 0)               AS lotes_avisados
`;

async function reporte(req, res) {
  const { rows } = await pool.query(CONSULTA);
  const r = rows[0] || {};

  const vivos = Number(r.vivos || 0);
  const vencidos = Number(r.vencidos || 0);

  return res.json({
    mes: {
      emitidos: Number(r.emitidos_mes || 0),
      canjeados: Number(r.canjeados_mes || 0),
    },
    total: {
      emitidos: Number(r.emitidos_total || 0),
      canjeados: Number(r.canjeados_total || 0),
      en_espera: Number(r.en_espera_movimientos || 0),
    },
    saldo: {
      vivos,
      vencidos,
      pasivo_pesos: vivos * VALOR_PUNTO_COP,
      // Tasa de uso: cuántos de los puntos emitidos se gastaron de verdad. Un
      // programa donde nadie canjea no es un incentivo, es una promesa.
      tasa_canje: Number(r.emitidos_total || 0) > 0
        ? Number(((Number(r.canjeados_total || 0) / Number(r.emitidos_total)) * 100).toFixed(1))
        : 0,
    },
    avisos: { lotes_avisados: Number(r.lotes_avisados || 0) },
    valor_punto_cop: VALOR_PUNTO_COP,
  });
}

/// GET /api/rewards/revisiones — conversiones marcadas por antifraude.
///
/// Muestra el correo enmascarado: quien revisa necesita distinguir cuentas, no
/// leer datos personales completos.
async function revisiones(req, res) {
  const { rows } = await pool.query(
    `SELECT c.id, c.created_at, c.motivo_revision, c.order_id,
            r.nombre AS referente,
            i.nombre AS invitada, i.email AS invitada_email
       FROM referral_conversions c
       JOIN usuarios r ON r.id = c.referrer_user_id
       JOIN usuarios i ON i.id = c.invitee_user_id
      WHERE c.estado = 'EN_REVISION'
      ORDER BY c.created_at DESC
      LIMIT 200`
  );

  return res.json({
    total: rows.length,
    revisiones: rows.map((f) => ({
      ...f,
      invitada_email: f.invitada_email ? maskEmail(f.invitada_email) : null,
    })),
  });
}

/// POST /api/rewards/revisiones/:id/aprobar — acredita el premio retenido.
///
/// Se acredita con la referencia del pedido original, así que si el webhook ya
/// hubiera creado el lote, `ON CONFLICT` impide pagar dos veces.
async function aprobarRevision(req, res) {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const conv = await client.query(
      `SELECT * FROM referral_conversions WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (conv.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Conversión no encontrada' });
    }
    const conversion = conv.rows[0];
    if (conversion.estado !== 'EN_REVISION') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `La conversión ya está en estado ${conversion.estado}`,
      });
    }

    const premio = await pointsService.acreditar({
      userId: conversion.referrer_user_id,
      puntos: PUNTOS_POR_COMPRA_REFERIDA,
      origen: 'referido:compra',
      referenciaId: conversion.order_id
        ? String(conversion.order_id)
        : `revision:${conversion.id}`,
      motivo: 'Premio aprobado tras revisión antifraude',
      cliente: client,
    });

    await client.query(
      `UPDATE referral_conversions
          SET estado = 'ACREDITADA',
              points_awarded = $2,
              motivo_revision = 'Aprobada en revisión manual'
        WHERE id = $1`,
      [id, PUNTOS_POR_COMPRA_REFERIDA]
    );

    await client.query('COMMIT');
    return res.json({
      id,
      estado: 'ACREDITADA',
      puntos: premio.acreditado ? PUNTOS_POR_COMPRA_REFERIDA : 0,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ [REVISIÓN] No se pudo aprobar:', error.message);
    return res.status(500).json({ error: 'No se pudo aprobar la conversión' });
  } finally {
    client.release();
  }
}

/// POST /api/rewards/revisiones/:id/rechazar — cierra el caso sin pagar.
async function rechazarRevision(req, res) {
  const { id } = req.params;
  const { motivo } = req.body || {};

  const res2 = await pool.query(
    `UPDATE referral_conversions
        SET estado = 'RECHAZADA',
            motivo_revision = COALESCE($2, 'Rechazada en revisión manual')
      WHERE id = $1 AND estado = 'EN_REVISION'
      RETURNING id`,
    [id, motivo || null]
  );

  if ((res2.rowCount || 0) === 0) {
    return res.status(409).json({ error: 'La conversión no está en revisión' });
  }
  return res.json({ id, estado: 'RECHAZADA' });
}

module.exports = { reporte, revisiones, aprobarRevision, rechazarRevision };


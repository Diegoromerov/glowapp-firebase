// src/controllers/rewardsAdminController.js
//
// Reporte de gestión del programa de puntos.
//
// Los puntos emitidos y no canjeados son un pasivo: una obligación de dar
// descuento sobre el catálogo propio. Sin estas cuatro cifras —emitido, canjeado,
// vencido y vivo— el programa crece a ciegas y nadie puede provisionarlo.
const { pool } = require('../config/db');
const { VALOR_PUNTO_COP } = require('../config/programaPuntos');

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

module.exports = { reporte };

// src/controllers/rewardsController.js
//
// Saldo del fondo de puntos canjeable. Sólo lectura: el canje se hace al crear el
// pedido (E2), no con un endpoint aparte, para que no exista un camino donde los
// puntos salgan del saldo sin un pedido que los respalde.
const pointsService = require('../services/pointsService');
const {
  VALOR_PUNTO_COP,
  BLOQUE_CANJE,
  TOPE_PORCENTAJE,
  MINIMO_PEDIDO,
} = require('../config/programaPuntos');

const DIAS_AVISO_VENCIMIENTO = 30;

/// GET /api/rewards/points
///
/// Devuelve el saldo disponible, lo que está comprometido en pedidos sin pagar y
/// lo que vence pronto, más las reglas vigentes del canje para que la app no las
/// tenga escritas a mano. Sin puntos devuelve 200 con ceros: no tener saldo no es
/// un error.
async function obtenerPuntos(req, res) {
  const userId = req.user && req.user.id;
  if (!userId) {
    return res.status(401).json({ error: 'Sesión requerida' });
  }

  const { saldo, porVencer, enEspera } = await pointsService.saldo({ userId });
  const lotes = await pointsService.lotesVigentes({ userId });

  const limite = Date.now() + DIAS_AVISO_VENCIMIENTO * 24 * 60 * 60 * 1000;
  const porVencerDetalle = lotes
    .filter((l) => new Date(l.vence_en).getTime() <= limite)
    .map((l) => ({ puntos: Number(l.puntos_restantes), vence_en: l.vence_en }));

  return res.json({
    saldo,
    en_espera: enEspera,
    saldo_en_pesos: saldo * VALOR_PUNTO_COP,
    valor_punto_cop: VALOR_PUNTO_COP,
    bloque_canje: BLOQUE_CANJE,
    tope_porcentaje: TOPE_PORCENTAJE,
    minimo_pedido: MINIMO_PEDIDO,
    por_vencer: porVencerDetalle,
    por_vencer_total: porVencer,
    lotes: lotes.map((l) => ({
      puntos: Number(l.puntos_restantes),
      origen: l.origen,
      creado_en: l.creado_en,
      vence_en: l.vence_en,
    })),
  });
}

module.exports = { obtenerPuntos };

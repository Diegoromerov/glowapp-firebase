// src/services/pointsService.js
//
// Libro del dinero del programa de puntos.
//
// Decisión D-01 (aprobada 2026-11-12): el dinero NO vive en `xp_logs`. `xp_logs`
// sigue siendo el libro del XP de estado (niveles, insignias, compartires); este
// servicio lleva el fondo canjeable, con lote, vencimiento y clave de
// idempotencia por movimiento.
//
// El modelo, en una frase: cada acreditación crea un LOTE con su fecha de
// vencimiento; el saldo es la suma de los restos vigentes; comprometer descuenta
// del lote que vence antes (FEFO) sin gastar; consumir convierte la espera en
// gasto cuando el pedido se paga; liberar devuelve lo comprometido si el pedido
// se cae.
//
// Nada aquí abre transacciones propias: el llamador decide. `comprometer`,
// `consumir` y `liberar` tienen que correr dentro de la transacción del pedido
// para que el bloqueo de fila (`FOR UPDATE`) sea real.

const { pool: poolPorDefecto } = require('../config/db');
const {
  VALOR_PUNTO_COP,
  BLOQUE_CANJE,
  MESES_VIGENCIA,
} = require('../config/programaPuntos');

/// Error con código estable: el controlador lo traduce a HTTP y la app puede
/// mostrar el motivo sin adivinar. Nunca se lanza un string.
class PointsError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'PointsError';
    this.code = code;
    this.statusCode = extra.statusCode || 400;
    Object.assign(this, extra);
  }
}

function esEnteroPositivo(n) {
  return Number.isInteger(n) && n > 0;
}

/// Crea el lote de una acreditación. Idempotente por (origen, referencia_id).
///
/// `referenciaId` es el pedido que causó el premio (o el id del `xp_logs`
/// histórico en el backfill). Si el mismo origen con la misma referencia llega
/// dos veces —webhook repetido, job reintentado— la segunda no crea nada.
async function acreditar({
  userId,
  puntos,
  origen,
  referenciaId = null,
  motivo = null,
  venceEn = null,
  cliente = poolPorDefecto,
} = {}) {
  if (!esEnteroPositivo(puntos)) {
    throw new PointsError('PUNTOS_INVALIDOS', 'Los puntos a acreditar deben ser un entero positivo');
  }
  if (!userId || !origen) {
    throw new PointsError('ACREDITACION_INVALIDA', 'La acreditación necesita usuario y origen');
  }

  const res = await cliente.query(
    `INSERT INTO points_lots
       (user_id, puntos, puntos_restantes, origen, referencia_id, motivo, vence_en)
     VALUES ($1, $2, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW() + INTERVAL '12 months'))
     ON CONFLICT (origen, referencia_id) WHERE referencia_id IS NOT NULL DO NOTHING
     RETURNING id, puntos, vence_en`,
    [userId, puntos, origen, referenciaId, motivo, venceEn]
  );

  const fila = res.rows && res.rows[0];
  return { acreditado: Boolean(fila), lotId: fila ? fila.id : null };
}

/// Saldo disponible, lo que está comprometido y lo que vence pronto.
///
/// `saldo` ya excluye dos cosas: lo vencido (por la condición sobre `vence_en`)
/// y lo comprometido en un pedido (porque `comprometer` descuenta del lote). Por
/// eso `enEspera` se informa aparte y nunca se suma.
async function saldo({ userId, cliente = poolPorDefecto } = {}) {
  const res = await cliente.query(
    `SELECT COALESCE(SUM(puntos_restantes), 0)::int AS saldo,
            COALESCE(SUM(CASE WHEN vence_en <= NOW() + INTERVAL '30 days'
                              THEN puntos_restantes ELSE 0 END), 0)::int AS por_vencer
       FROM points_lots
      WHERE user_id = $1
        AND vence_en > NOW()
        AND puntos_restantes > 0`,
    [userId]
  );

  const espera = await cliente.query(
    `SELECT COALESCE(SUM(m.puntos), 0)::int AS en_espera
       FROM points_movements m
      WHERE m.user_id = $1
        AND m.tipo = 'compromiso'
        AND NOT EXISTS (
          SELECT 1 FROM points_movements x
           WHERE x.pedido_id = m.pedido_id
             AND x.lot_id = m.lot_id
             AND x.tipo IN ('consumo', 'liberacion')
        )`,
    [userId]
  );

  const fila = (res.rows && res.rows[0]) || {};
  const filaEspera = (espera.rows && espera.rows[0]) || {};
  return {
    saldo: Number(fila.saldo || 0),
    porVencer: Number(fila.por_vencer || 0),
    enEspera: Number(filaEspera.en_espera || 0),
  };
}

/// Detalle de los lotes vigentes, para que la app muestre de dónde sale el saldo
/// y cuándo vence. Ordenado por vencimiento: lo primero que se va, arriba.
async function lotesVigentes({ userId, cliente = poolPorDefecto } = {}) {
  const res = await cliente.query(
    `SELECT id, puntos, puntos_restantes, origen, motivo, creado_en, vence_en
       FROM points_lots
      WHERE user_id = $1
        AND vence_en > NOW()
        AND puntos_restantes > 0
      ORDER BY vence_en ASC`,
    [userId]
  );
  return res.rows || [];
}

/// Compromete puntos en un pedido que todavía no se pagó.
///
/// Consume del lote que vence antes (FEFO), deja un movimiento por lote y
/// devuelve el desglose. Si el saldo no alcanza, lanza y no escribe nada: quien
/// llama está en una transacción y decide si hace ROLLBACK.
///
/// El movimiento se inserta ANTES de descontar y con `ON CONFLICT (clave) DO
/// NOTHING`: si la misma clave vuelve a llegar, no se descuenta dos veces.
async function comprometer({ userId, pedidoId, puntos, cliente } = {}) {
  if (!pedidoId) {
    throw new PointsError('PEDIDO_REQUERIDO', 'Los puntos se comprometen contra un pedido concreto');
  }
  if (!esEnteroPositivo(puntos) || puntos % BLOQUE_CANJE !== 0) {
    throw new PointsError(
      'BLOQUE_INVALIDO',
      `Los puntos se canjean en bloques de ${BLOQUE_CANJE}; llegó ${puntos}`
    );
  }
  if (!cliente) {
    throw new PointsError(
      'CLIENTE_REQUERIDO',
      'Comprometer exige la conexión transaccionada del pedido'
    );
  }

  const res = await cliente.query(
    `SELECT id, puntos_restantes, vence_en
       FROM points_lots
      WHERE user_id = $1
        AND vence_en > NOW()
        AND puntos_restantes > 0
      ORDER BY vence_en ASC, creado_en ASC
      FOR UPDATE`,
    [userId]
  );

  const lotes = res.rows || [];
  const disponible = lotes.reduce((t, l) => t + Number(l.puntos_restantes || 0), 0);
  if (disponible < puntos) {
    throw new PointsError('SALDO_INSUFICIENTE', 'No hay puntos suficientes para este canje', {
      disponible,
      solicitado: puntos,
    });
  }

  const desglose = [];
  let faltan = puntos;

  for (const lote of lotes) {
    if (faltan <= 0) break;
    const toma = Math.min(Number(lote.puntos_restantes), faltan);
    const clave = `canje:${pedidoId}:compromiso:${lote.id}`;

    const mov = await cliente.query(
      `INSERT INTO points_movements (lot_id, user_id, pedido_id, tipo, puntos, clave, motivo)
       VALUES ($1, $2, $3, 'compromiso', $4, $5, $6)
       ON CONFLICT (clave) DO NOTHING
       RETURNING id`,
      [lote.id, userId, pedidoId, toma, clave, 'Puntos aplicados al pedido']
    );

    // Si la clave ya existía, este compromiso ya se hizo: no se vuelve a descontar.
    if (!mov || mov.rowCount === 0) {
      faltan -= toma;
      continue;
    }

    const upd = await cliente.query(
      `UPDATE points_lots
          SET puntos_restantes = puntos_restantes - $1
        WHERE id = $2
          AND puntos_restantes >= $1`,
      [toma, lote.id]
    );

    if (!upd || upd.rowCount === 0) {
      // Sin el bloqueo de fila esto sería una carrera; con él, es un error de
      // programación. Se falla fuerte antes que perder un punto.
      throw new PointsError('CONCURRENCIA', 'El lote cambió durante el compromiso');
    }

    desglose.push({ lotId: lote.id, puntos: toma });
    faltan -= toma;
  }

  return {
    aplicado: desglose.reduce((t, d) => t + d.puntos, 0),
    desglose,
  };
}

/// Convierte la espera en gasto. Se llama cuando el pago se confirma.
///
/// No mueve saldo: los puntos ya salieron del lote al comprometerse. Sólo deja
/// el rastro que distingue "en espera" de "gastado".
async function consumir({ pedidoId, cliente = poolPorDefecto } = {}) {
  const res = await cliente.query(
    `INSERT INTO points_movements (lot_id, user_id, pedido_id, tipo, puntos, clave, motivo)
     SELECT m.lot_id, m.user_id, m.pedido_id, 'consumo', m.puntos,
            REPLACE(m.clave, ':compromiso:', ':consumo:'), 'Canje confirmado con el pago'
       FROM points_movements m
      WHERE m.pedido_id = $1
        AND m.tipo = 'compromiso'
        AND NOT EXISTS (
          SELECT 1 FROM points_movements x
           WHERE x.pedido_id = m.pedido_id
             AND x.lot_id = m.lot_id
             AND x.tipo IN ('consumo', 'liberacion')
        )
     ON CONFLICT (clave) DO NOTHING
     RETURNING id`,
    [pedidoId]
  );

  // `rowCount` es el número de filas insertadas por el INSERT ... SELECT, y es 0
  // cuando todas chocaron con la clave: el pedido ya estaba consumido.
  return { consumidos: res.rowCount || 0 };
}

/// Devuelve los puntos de un pedido que se cayó (cancelado o vencido 24 h).
///
/// Reingresa al mismo lote, sin superar su tamaño original: si el lote venció
/// mientras estaba comprometido, `LEAST` evita que el reingreso lo reviva.
async function liberar({ pedidoId, cliente = poolPorDefecto } = {}) {
  const res = await cliente.query(
    `SELECT m.id, m.lot_id, m.user_id, m.puntos
       FROM points_movements m
      WHERE m.pedido_id = $1
        AND m.tipo = 'compromiso'
        AND NOT EXISTS (
          SELECT 1 FROM points_movements x
           WHERE x.pedido_id = m.pedido_id
             AND x.lot_id = m.lot_id
             AND x.tipo IN ('consumo', 'liberacion')
        )
      FOR UPDATE`,
    [pedidoId]
  );

  const pendientes = res.rows || [];
  let liberados = 0;

  for (const mov of pendientes) {
    const clave = `canje:${pedidoId}:liberacion:${mov.lot_id}`;
    const ins = await cliente.query(
      `INSERT INTO points_movements (lot_id, user_id, pedido_id, tipo, puntos, clave, motivo)
       VALUES ($1, $2, $3, 'liberacion', $4, $5, $6)
       ON CONFLICT (clave) DO NOTHING
       RETURNING id`,
      [mov.lot_id, mov.user_id, pedidoId, mov.puntos, clave, 'Pedido no pagado: puntos devueltos']
    );
    if (!ins || ins.rowCount === 0) continue;

    await cliente.query(
      `UPDATE points_lots
          SET puntos_restantes = LEAST(puntos, puntos_restantes + $1)
        WHERE id = $2`,
      [mov.puntos, mov.lot_id]
    );
    liberados += Number(mov.puntos);
  }

  return { liberados };
}

/// Revierte un premio (reembolso del pedido que lo originó).
///
/// Devuelve sólo lo que quede sin gastar del lote de origen: si la referente ya
/// lo usó, se informa `noCubierto` para revisión manual y nunca se le deja saldo
/// negativo.
async function revertir({ origen, referenciaId, puntos = null, cliente = poolPorDefecto } = {}) {
  const res = await cliente.query(
    `SELECT id, puntos_restantes
       FROM points_lots
      WHERE origen = $1
        AND referencia_id = $2
      FOR UPDATE`,
    [origen, referenciaId]
  );

  const lote = res.rows && res.rows[0];
  if (!lote) {
    throw new PointsError('LOTE_NO_ENCONTRADO', 'No hay lote que revertir para esa referencia', {
      statusCode: 404,
    });
  }

  const restantes = Number(lote.puntos_restantes || 0);
  const pedido = puntos === null ? restantes : puntos;
  const revertido = Math.min(restantes, pedido);

  if (revertido > 0) {
    const clave = `reversion:${origen}:${referenciaId}`;
    const ins = await cliente.query(
      `INSERT INTO points_movements (lot_id, user_id, pedido_id, tipo, puntos, clave, motivo)
       SELECT id, user_id, NULL, 'reversion', $3, $1, $4
         FROM points_lots WHERE id = $2
       ON CONFLICT (clave) DO NOTHING
       RETURNING id`,
      [clave, lote.id, revertido, 'Reversión por reembolso del pedido de origen']
    );

    if (ins && ins.rowCount > 0) {
      await cliente.query(
        `UPDATE points_lots
            SET puntos_restantes = puntos_restantes - $1
          WHERE id = $2
            AND puntos_restantes >= $1`,
        [revertido, lote.id]
      );
    }
  }

  return { revertido, noCubierto: Math.max(pedido - revertido, 0) };
}

module.exports = {
  PointsError,
  acreditar,
  saldo,
  lotesVigentes,
  comprometer,
  consumir,
  liberar,
  revertir,
  VALOR_PUNTO_COP,
  BLOQUE_CANJE,
  MESES_VIGENCIA,
};

/**
 * Cuotas de análisis con IA: estado del mes y registro de consumo.
 *
 * La cuota cuelga del uso (decisión del Director): se cuentan hechos del mes
 * —reservas completadas y compras pagadas— y el nivel sólo suma su bono.
 *
 * Las columnas están verificadas contra el esquema real de producción:
 *   bookings.client_id, bookings.estado (enum), bookings.completed_at
 *   pedidos_tienda.comprador_id, .estado, .pagado_en
 *   xp_logs.user_id, .xp_amount
 *   ai_usage_events.user_id, .tipo_uso, .lectura_tipo
 */
const { pool } = require('../config/db');
const {
  lecturasOtorgadas,
  costoDeLecturas,
  COSTO_LECTURA_COP,
  NIVELES,
} = require('../config/cuotasIA');

const TIPO_ANALISIS = 'analisis';

/** Hechos del mes y consumo: todo en una consulta, con el contexto ya puesto. */
async function hechosDelMes({ userId, cliente = pool } = {}) {
  const r = await cliente.query(
    `SELECT
       (SELECT COUNT(*)::int FROM bookings b
         WHERE b.client_id = $1
           AND b.estado::text = 'COMPLETADA'
           AND COALESCE(b.completed_at, b.created_at) >= date_trunc('month', NOW())) AS reservas,
       (SELECT COUNT(*)::int FROM pedidos_tienda p
         WHERE p.comprador_id = $1
           AND p.estado = 'PAGADO'
           AND COALESCE(p.pagado_en, p.creado_en) >= date_trunc('month', NOW())) AS compras,
       (SELECT COALESCE(SUM(x.xp_amount), 0)::int FROM xp_logs x
         WHERE x.user_id = $1 AND x.xp_amount > 0) AS xp,
       (SELECT COUNT(*)::int FROM ai_usage_events e
         WHERE e.user_id = $1 AND e.tipo_uso = '${TIPO_ANALISIS}') AS usados`,
    [userId]
  );
  const f = (r && r.rows && r.rows[0]) || {};
  return {
    reservas: Number(f.reservas || 0),
    compras: Number(f.compras || 0),
    xp: Number(f.xp || 0),
    usados: Number(f.usados || 0),
  };
}

/**
 * Estado de cuota del mes para una usuaria.
 *
 * `disponibles` nunca es negativo: si el consumo supera lo otorgado (por ejemplo
 * tras un cambio de reglas), la pantalla muestra 0 y no una deuda.
 */
async function estadoDelMes({ userId, cliente = pool } = {}) {
  const hechos = await hechosDelMes({ userId, cliente });
  const regla = lecturasOtorgadas({
    reservas: hechos.reservas,
    compras: hechos.compras,
    xp: hechos.xp,
    yaUsoBase: hechos.usados > 0,
  });

  const disponibles = Math.max(regla.otorgadas - hechos.usados, 0);
  const indice = NIVELES.findIndex((n) => n.clave === regla.nivel.clave);
  const siguiente = NIVELES[indice + 1] || null;

  return {
    nivel: regla.nivel.nombre,
    nivel_clave: regla.nivel.clave,
    xp: hechos.xp,
    xp_siguiente_nivel: siguiente ? siguiente.xp : null,
    nivel_siguiente: siguiente ? siguiente.nombre : null,
    lecturas: {
      otorgadas: regla.otorgadas,
      usadas: hechos.usados,
      disponibles,
      desglose: regla.desglose,
    },
    hechos: { reservas: hechos.reservas, compras: hechos.compras },
    costos: {
      lectura_sd_cop: COSTO_LECTURA_COP.SD,
      lectura_hd_cop: COSTO_LECTURA_COP.HD,
      costo_si_usa_todo_hd: costoDeLecturas({ HD: disponibles }),
    },
    generado_en: new Date().toISOString(),
  };
}

/**
 * Registra una llamada a proveedor de IA. Idempotente por `clave`.
 * Devuelve `{registrado:false}` cuando la clave ya existía.
 */
async function registrarConsumo({
  userId,
  proveedor,
  modelo = null,
  tipoUso = TIPO_ANALISIS,
  lecturaTipo = null,
  puntosConsumidos = null,
  tokensEntrada = null,
  tokensSalida = null,
  traceId = null,
  clave = null,
  cliente = pool,
} = {}) {
  if (!proveedor) throw new Error('proveedor es obligatorio');
  const costo = lecturaTipo ? costoDeLecturas({ [lecturaTipo]: 1 }) : null;
  const r = await cliente.query(
    `INSERT INTO ai_usage_events
       (user_id, proveedor, modelo, tipo_uso, lectura_tipo, puntos_consumidos,
        tokens_entrada, tokens_salida, costo_cop, trace_id, clave)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (clave) DO NOTHING
     RETURNING id`,
    [userId, proveedor, modelo, tipoUso, lecturaTipo, puntosConsumidos,
      tokensEntrada, tokensSalida, costo, traceId, clave]
  );
  return { registrado: Boolean(r && r.rowCount > 0), costoCop: costo };
}

module.exports = { hechosDelMes, estadoDelMes, registrarConsumo, TIPO_ANALISIS };

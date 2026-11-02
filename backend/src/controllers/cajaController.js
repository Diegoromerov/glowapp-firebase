// backend/src/controllers/cajaController.js
// E-05 (D-GL-027) — Caja del salón.
//
// REGLAS QUE ESTE CONTROLADOR HACE CUMPLIR
//  1. Nada se calcula en el cliente: los KPIs son agregados de `caja_movimientos`.
//  2. Un colaborador (`MEMBER`/prestador/empleado) sólo ve lo que está atribuido
//     a su `persona_id`; nunca la caja completa del salón. El filtro se aplica en
//     la consulta, no en la presentación.
//  3. Registrar dinero exige rol de administración o recepción. Leer no.
//  4. La constancia es un comprobante propio del salón, con numeración local.
//     No hay facturación electrónica ni integración fiscal: así lo decidió el
//     Director y el código no finge lo contrario.
//  5. Los importes se devuelven como número (no string) para que el cliente no
//     tenga que adivinar el formato.

const { pool } = require('../config/db');

const ROLES_QUE_VEN_TODO = new Set(['DUEÑO', 'ADMINISTRADOR', 'RECEPCIONISTA', 'MANAGER']);
const ROLES_QUE_REGISTRAN = new Set(['DUEÑO', 'ADMINISTRADOR', 'RECEPCIONISTA', 'MANAGER']);

const TIPOS = new Set(['INGRESO', 'GASTO']);
const CONCEPTOS = new Set([
  'SERVICIO', 'PRODUCTO', 'PROPINA', 'ALQUILER', 'COMISION',
  'INSUMO', 'NOMINA', 'OTRO',
]);
const METODOS = new Set([
  'EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'NEQUI', 'DAVIPLATA', 'OTRO',
]);

/** Rango por defecto: el mes en curso. Sin fechas no se inventan totales. */
function resolverPeriodo(desde, hasta) {
  const hoy = new Date();
  const inicio = desde
    ? new Date(desde)
    : new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
  const fin = hasta ? new Date(hasta) : hoy;
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) {
    return null;
  }
  if (inicio > fin) return null;
  // El fin incluye el día completo.
  const finDia = new Date(fin);
  finDia.setUTCHours(23, 59, 59, 999);
  return { inicio, fin: finDia };
}

function alcanceDe(membership) {
  const rol = String((membership && membership.sub_rol) || '').toUpperCase();
  return {
    rol,
    veTodo: ROLES_QUE_VEN_TODO.has(rol),
    puedeRegistrar: ROLES_QUE_REGISTRAN.has(rol),
  };
}

/** Numeración local: CJ-<salon>-<AAAAMMDD>-<4 hex>. */
function nuevaConstancia(salonId) {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(
    d.getUTCDate()
  ).padStart(2, '0')}`;
  const sufijo = Math.random().toString(16).slice(2, 6).toUpperCase().padEnd(4, '0');
  return `CJ-${salonId}-${ymd}-${sufijo}`;
}

function crearControladorCaja(db = pool) {
  /** Filtro de persona según rol. Devuelve el fragmento SQL y sus parámetros. */
  function filtroAlcance(alcance, userId) {
    if (alcance.veTodo) return { sql: '', params: [] };
    return { sql: ' AND persona_id = $4', params: [userId] };
  }

  /** GET /api/salon/:salonId/caja/resumen?desde&hasta */
  async function resumen(req, res) {
    const alcance = alcanceDe(req.salonMembership);
    const periodo = resolverPeriodo(req.query.desde, req.query.hasta);
    if (!periodo) {
      return res.status(400).json({ error: 'Rango de fechas inválido.' });
    }

    const filtro = filtroAlcance(alcance, req.user.id);
    const base = `
      FROM caja_movimientos
     WHERE salon_id = $1
       AND fecha_movimiento >= $2
       AND fecha_movimiento <= $3
       ${filtro.sql}
    `;
    const params = [req.salonId, periodo.inicio, periodo.fin, ...filtro.params];

    try {
      const totales = await db.query(
        `SELECT
           COALESCE(SUM(CASE WHEN tipo = 'INGRESO' THEN monto END), 0)::numeric AS ingresos,
           COALESCE(SUM(CASE WHEN tipo = 'GASTO'   THEN monto END), 0)::numeric AS gastos,
           COUNT(*)::int AS movimientos
         ${base}`,
        params
      );

      const porConcepto = await db.query(
        `SELECT tipo, concepto, COALESCE(SUM(monto), 0)::numeric AS total, COUNT(*)::int AS n
         ${base}
         GROUP BY tipo, concepto
         ORDER BY tipo, total DESC`,
        params
      );

      const { ingresos, gastos, movimientos } = totales.rows[0];
      const ingreso = Number(ingresos);
      const gasto = Number(gastos);

      return res.json({
        success: true,
        periodo: { desde: periodo.inicio.toISOString(), hasta: periodo.fin.toISOString() },
        ingresos: ingreso,
        gastos: gasto,
        neto: Number((ingreso - gasto).toFixed(2)),
        movimientos,
        por_concepto: porConcepto.rows.map((r) => ({
          tipo: r.tipo,
          concepto: r.concepto,
          total: Number(r.total),
          movimientos: r.n,
        })),
        alcance: alcance.veTodo ? 'SALON' : 'PROPIO',
        mi_rol: alcance.rol,
        puede_registrar: alcance.puedeRegistrar,
        moneda: 'COP',
      });
    } catch (error) {
      console.error('❌ ERROR resumenCaja:', error.message);
      return res.status(500).json({ error: 'No se pudo calcular la caja.' });
    }
  }

  /** GET /api/salon/:salonId/caja/movimientos?desde&hasta&limite&offset */
  async function movimientos(req, res) {
    const alcance = alcanceDe(req.salonMembership);
    const periodo = resolverPeriodo(req.query.desde, req.query.hasta);
    if (!periodo) {
      return res.status(400).json({ error: 'Rango de fechas inválido.' });
    }

    const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    // El filtro por persona sólo existe en la consulta del colaborador.
    const params = alcance.veTodo
      ? [req.salonId, periodo.inicio, periodo.fin, limite, offset]
      : [req.salonId, periodo.inicio, periodo.fin, limite, req.user.id, offset];

    const sql = alcance.veTodo
      ? `SELECT id, tipo, concepto, descripcion, monto, moneda, metodo_pago,
                persona_id, booking_id, constancia_ref, registrado_por, fecha_movimiento
           FROM caja_movimientos
          WHERE salon_id = $1 AND fecha_movimiento >= $2 AND fecha_movimiento <= $3
          ORDER BY fecha_movimiento DESC
          LIMIT $4 OFFSET $5`
      : `SELECT id, tipo, concepto, descripcion, monto, moneda, metodo_pago,
                persona_id, booking_id, constancia_ref, registrado_por, fecha_movimiento
           FROM caja_movimientos
          WHERE salon_id = $1 AND fecha_movimiento >= $2 AND fecha_movimiento <= $3
            AND persona_id = $5
          ORDER BY fecha_movimiento DESC
          LIMIT $4 OFFSET $6`;

    try {
      const { rows } = await db.query(sql, params);
      return res.json({
        success: true,
        alcance: alcance.veTodo ? 'SALON' : 'PROPIO',
        total: rows.length,
        limite,
        offset,
        items: rows.map((r) => ({
          ...r,
          monto: Number(r.monto),
        })),
      });
    } catch (error) {
      console.error('❌ ERROR movimientosCaja:', error.message);
      return res.status(500).json({ error: 'No se pudieron leer los movimientos.' });
    }
  }

  /** POST /api/salon/:salonId/caja/movimientos */
  async function registrar(req, res) {
    const alcance = alcanceDe(req.salonMembership);
    if (!alcance.puedeRegistrar) {
      return res.status(403).json({
        error: 'Tu rol no registra movimientos de caja.',
        mi_rol: alcance.rol,
      });
    }

    const {
      tipo, concepto, monto, metodo_pago: metodoPago, descripcion,
      persona_id: personaId, booking_id: bookingId, fecha_movimiento: fecha,
    } = req.body || {};

    const tipoNorm = String(tipo || '').toUpperCase();
    const conceptoNorm = String(concepto || '').toUpperCase();
    const metodoNorm = String(metodoPago || 'EFECTIVO').toUpperCase();
    const montoNum = Number(monto);

    if (!TIPOS.has(tipoNorm)) {
      return res.status(400).json({ error: 'tipo debe ser INGRESO o GASTO.' });
    }
    if (!CONCEPTOS.has(conceptoNorm)) {
      return res.status(400).json({ error: 'concepto no válido.', validos: [...CONCEPTOS] });
    }
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      return res.status(400).json({ error: 'monto debe ser un número mayor que cero.' });
    }
    if (!METODOS.has(metodoNorm)) {
      return res.status(400).json({ error: 'metodo_pago no válido.', validos: [...METODOS] });
    }
    if (montoNum > 999999999) {
      return res.status(400).json({ error: 'monto fuera de rango.' });
    }

    try {
      // El inquilino sale del perfil de negocio, que es la fuente única
      // (D-GL-027). `salones.tenant_id` es legado y puede estar en NULL: leerlo
      // dejaba la caja en 500 con salones reales, porque el INSERT recibía NULL
      // en una columna NOT NULL.
      const { rows: perfilRows } = await db.query(
        `SELECT tenant_id FROM business_profiles
          WHERE id = left('salon-' || $1::text, 36)`,
        [req.salonId]
      );
      if (perfilRows.length === 0) {
        return res.status(409).json({
          error: 'El salón no tiene identidad provisionada (business_profiles).',
          salon_id: Number(req.salonId),
        });
      }

      const constancia = nuevaConstancia(req.salonId);
      const { rows } = await db.query(
        `INSERT INTO caja_movimientos
           (tenant_id, salon_id, tipo, concepto, descripcion, monto, metodo_pago,
            persona_id, booking_id, constancia_ref, registrado_por, fecha_movimiento)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12::timestamptz, NOW()))
         RETURNING id, tipo, concepto, monto, metodo_pago, constancia_ref, fecha_movimiento`,
        [
          perfilRows[0].tenant_id, req.salonId, tipoNorm, conceptoNorm,
          descripcion || null, montoNum, metodoNorm,
          personaId || null, bookingId || null, constancia, req.user.id,
          fecha || null,
        ]
      );

      return res.status(201).json({
        success: true,
        movimiento: { ...rows[0], monto: Number(rows[0].monto) },
      });
    } catch (error) {
      console.error('❌ ERROR registrarMovimientoCaja:', error.message);
      return res.status(500).json({ error: 'No se pudo registrar el movimiento.' });
    }
  }

  /** GET /api/salon/:salonId/caja/movimientos/:movimientoId/constancia */
  async function constancia(req, res) {
    const alcance = alcanceDe(req.salonMembership);
    try {
      const { rows } = await db.query(
        `SELECT m.id, m.tipo, m.concepto, m.descripcion, m.monto, m.moneda,
                m.metodo_pago, m.persona_id, m.constancia_ref, m.fecha_movimiento,
                s.nombre_salon, s.direccion, s.ciudad
           FROM caja_movimientos m
           JOIN salones s ON s.id = m.salon_id
          WHERE m.id = $1 AND m.salon_id = $2`,
        [req.params.movimientoId, req.salonId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Movimiento no encontrado en este salón.' });
      }

      const m = rows[0];
      if (!alcance.veTodo && Number(m.persona_id) !== Number(req.user.id)) {
        return res.status(403).json({ error: 'Este movimiento no está a tu nombre.' });
      }

      return res.json({
        success: true,
        constancia: {
          numero: m.constancia_ref,
          fecha: m.fecha_movimiento,
          salon: { nombre: m.nombre_salon, direccion: m.direccion, ciudad: m.ciudad },
          tipo: m.tipo,
          concepto: m.concepto,
          descripcion: m.descripcion,
          monto: Number(m.monto),
          moneda: m.moneda,
          metodo_pago: m.metodo_pago,
          persona_id: m.persona_id,
          // Se declara explícitamente para que nadie confunda esto con una factura.
          comprobante: 'CONSTANCIA_DE_PAGO',
          factura_electronica: false,
        },
      });
    } catch (error) {
      console.error('❌ ERROR constanciaCaja:', error.message);
      return res.status(500).json({ error: 'No se pudo emitir la constancia.' });
    }
  }

  return { resumen, movimientos, registrar, constancia };
}

module.exports = { ...crearControladorCaja(), crearControladorCaja };

const { pool } = require('../config/db');
const tenantRouting = require('../config/tenantRouting');
const { getColombiaDateParts, getColombiaDayRange, isValidColombiaDate, getColombiaSchedule } = require('../utils/bookingCalendar');

const DAY_MS = 86400000;
const MAX_RANGE_DAYS = 366;

function shiftDate(value, offset) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + offset, 12)).toISOString().slice(0, 10);
}

function resolvePeriod(query = {}, now = new Date()) {
  const today = getColombiaDateParts(now);
  const from = query.from || shiftDate(today, -29);
  const to = query.to || today;
  if (!isValidColombiaDate(from) || !isValidColombiaDate(to)) {
    const error = new Error('Las fechas deben tener formato YYYY-MM-DD y ser válidas.');
    error.status = 400;
    throw error;
  }
  if (from > to) {
    const error = new Error('La fecha inicial no puede ser posterior a la final.');
    error.status = 400;
    throw error;
  }
  const startRange = getColombiaDayRange(`${from}T12:00:00.000Z`);
  const endRange = getColombiaDayRange(`${to}T12:00:00.000Z`);
  const days = Math.round((endRange.start - startRange.start) / DAY_MS) + 1;
  if (days > MAX_RANGE_DAYS) {
    const error = new Error(`El período no puede superar ${MAX_RANGE_DAYS} días.`);
    error.status = 400;
    throw error;
  }
  return { from, to, days, start: startRange.start, endExclusive: endRange.endExclusive };
}

function capacityMinutes(providers, period) {
  let minutes = 0;
  for (const provider of providers) {
    for (let day = 0; day < period.days; day += 1) {
      const schedule = getColombiaSchedule({
        date: shiftDate(period.from, day),
        weeklySchedule: provider.weekly_schedule,
        activeStartHour: provider.active_start_hour,
        activeEndHour: provider.active_end_hour,
      });
      if (!schedule?.isActive) continue;
      const start = Number(schedule.startHour);
      const end = Number(schedule.endHour);
      if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end <= 24 && end > start) {
        minutes += (end - start) * 60;
      }
    }
  }
  return minutes;
}

async function getBusinessAnalytics({ tenantId, salonId = null, query = {}, now = new Date(), db = pool }) {
  if (!tenantId) {
    const error = new Error('Contexto de negocio requerido.');
    error.status = 401;
    throw error;
  }
  const period = resolvePeriod(query, now);
  return tenantRouting.runAsSystem({ pool: db }, async (client) => {
    const params = [tenantId, salonId, period.start, period.endExclusive];
    const [bookings, minutes, repeat, cash, inventory, team, providers] = await Promise.all([
      client.query(
        `WITH primary_bookings AS (
           SELECT DISTINCT ON (COALESCE(b.productos_adicionales->>'primary_booking_id', b.id::text))
                  COALESCE(b.productos_adicionales->>'primary_booking_id', b.id::text) AS logical_id,
                  b.client_id, b.estado::text AS status
             FROM bookings b
            WHERE b.business_profile_id = $1
              AND ($2::integer IS NULL OR b.salon_id = $2)
              AND b.scheduled_at >= $3 AND b.scheduled_at < $4
              AND COALESCE(b.productos_adicionales->>'is_primary', 'true') <> 'false'
            ORDER BY COALESCE(b.productos_adicionales->>'primary_booking_id', b.id::text), b.id
         )
         SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'COMPLETADA')::int AS completed,
                COUNT(*) FILTER (WHERE status IN ('CANCELADA', 'CANCELLED'))::int AS cancelled
           FROM primary_bookings`, params),
      client.query(
        `SELECT COALESCE(SUM(CASE WHEN b.estado::text NOT IN ('CANCELADA', 'CANCELLED')
                                  THEN COALESCE(s.duration_minutes, 60) ELSE 0 END), 0)::numeric AS reserved_minutes
           FROM bookings b
           LEFT JOIN services s ON s.id = b.service_id
          WHERE b.business_profile_id = $1
            AND ($2::integer IS NULL OR b.salon_id = $2)
            AND b.scheduled_at >= $3 AND b.scheduled_at < $4`, params),
      client.query(
        `WITH completed_by_client AS (
           SELECT b.client_id,
                  COUNT(DISTINCT COALESCE(b.productos_adicionales->>'primary_booking_id', b.id::text)) AS visits
             FROM bookings b
            WHERE b.business_profile_id = $1
              AND ($2::integer IS NULL OR b.salon_id = $2)
              AND b.client_id IS NOT NULL
              AND b.scheduled_at >= $3 AND b.scheduled_at < $4
              AND b.estado::text = 'COMPLETADA'
              AND COALESCE(b.productos_adicionales->>'is_primary', 'true') <> 'false'
            GROUP BY b.client_id
         )
         SELECT COUNT(*)::int AS clients,
                COUNT(*) FILTER (WHERE visits >= 2)::int AS repeat_clients
           FROM completed_by_client`, params),
      client.query(
        `SELECT cm.moneda AS currency,
                COALESCE(SUM(cm.monto) FILTER (WHERE cm.tipo = 'INGRESO'), 0)::numeric AS income,
                COALESCE(SUM(cm.monto) FILTER (WHERE cm.tipo = 'GASTO'), 0)::numeric AS expenses,
                COALESCE(SUM(cm.monto) FILTER (WHERE cm.tipo = 'INGRESO' AND cm.concepto = 'SERVICIO'), 0)::numeric AS service_income,
                COALESCE(SUM(cm.monto) FILTER (WHERE cm.tipo = 'INGRESO' AND cm.concepto = 'PRODUCTO'), 0)::numeric AS product_income,
                COUNT(*)::int AS movements
           FROM business_profiles bp
           JOIN caja_movimientos cm ON cm.tenant_id = bp.tenant_id
          WHERE bp.id = $1 AND ($2::integer IS NULL OR cm.salon_id = $2)
            AND cm.fecha_movimiento >= $3 AND cm.fecha_movimiento < $4
          GROUP BY cm.moneda ORDER BY cm.moneda`, params),
      client.query(
        `SELECT COUNT(*) FILTER (WHERE i.activo AND i.stock_actual <= i.stock_minimo)::int AS low_stock_items,
                COUNT(*) FILTER (WHERE i.activo AND i.categoria = 'PRODUCTO')::int AS active_products
           FROM business_profiles bp
           LEFT JOIN inventario_salon i ON i.tenant_id = bp.tenant_id
            AND ($2::integer IS NULL OR i.salon_id = $2)
          WHERE bp.id = $1`, params.slice(0, 2)),
      client.query(
        `SELECT COUNT(*)::int AS active_members
           FROM memberships WHERE business_profile_id = $1 AND status = 'ACTIVE'`, [tenantId]),
      salonId == null ? Promise.resolve({ rows: [] }) : client.query(
        `SELECT DISTINCT p.id, p.weekly_schedule, p.active_start_hour, p.active_end_hour
           FROM services s
           JOIN perfiles_prestador p ON p.id = s.provider_id AND p.is_active = TRUE
          WHERE s.business_profile_id = $1 AND s.salon_id = $2 AND s.is_active = TRUE`, [tenantId, salonId]),
    ]);

    const booking = bookings.rows[0] || {};
    const customerCounts = repeat.rows[0] || {};
    const availableMinutes = salonId == null ? 0 : capacityMinutes(providers.rows, period);
    const reservedMinutes = Number(minutes.rows[0]?.reserved_minutes || 0);
    const repeatClients = Number(customerCounts.repeat_clients || 0);
    const clients = Number(customerCounts.clients || 0);

    const shortages = await client.query(
      `SELECT COUNT(*) FILTER (WHERE faltante > 0)::int AS shortage_lines
         FROM business_profiles bp
         JOIN inventario_consumos_reserva ic ON ic.tenant_id = bp.tenant_id
        WHERE bp.id = $1 AND ($2::integer IS NULL OR ic.salon_id = $2)
          AND ic.creado_en >= $3 AND ic.creado_en < $4`, params);

    return {
      success: true,
      scope: { business_profile_id: tenantId, salon_id: salonId },
      period: { from: period.from, to: period.to, days: period.days, time_zone: 'America/Bogota' },
      appointments: {
        total: Number(booking.total || 0),
        completed: Number(booking.completed || 0),
        cancelled: Number(booking.cancelled || 0),
        completion_rate: Number(booking.total || 0) > 0
          ? Number((Number(booking.completed || 0) / Number(booking.total) * 100).toFixed(1)) : null,
        reserved_service_minutes: reservedMinutes,
      },
      customers: {
        completed_clients: clients,
        repeat_clients: repeatClients,
        repeat_rate: clients > 0 ? Number((repeatClients / clients * 100).toFixed(1)) : null,
        privacy: 'Solo conteos agregados; no se entregan nombres, correos ni identificadores de clientes.',
      },
      capacity: {
        available_minutes: availableMinutes || null,
        reserved_minutes: reservedMinutes,
        occupancy_rate: availableMinutes > 0
          ? Number((reservedMinutes / availableMinutes * 100).toFixed(1)) : null,
        basis: salonId == null ? 'Selecciona una sede para calcular ocupación.'
          : providers.rows.length === 0 ? 'No hay horarios de prestadores activos configurados para esta sede.'
            : 'Minutos de servicios no cancelados / minutos de horario configurado de prestadores activos; no descuenta pausas ni cierres excepcionales.',
      },
      cash: {
        by_currency: cash.rows.map((row) => ({
          currency: String(row.currency || '').trim(),
          income: Number(row.income || 0),
          expenses: Number(row.expenses || 0),
          net: Number(row.income || 0) - Number(row.expenses || 0),
          service_income: Number(row.service_income || 0),
          product_income: Number(row.product_income || 0),
          movements: Number(row.movements || 0),
        })),
        source: 'Libro de caja del salón; no suma reservas ni pagos de GlowApp para evitar duplicarlos.',
      },
      inventory: {
        low_stock_items: Number(inventory.rows[0]?.low_stock_items || 0),
        active_products: Number(inventory.rows[0]?.active_products || 0),
        shortage_lines: Number(shortages.rows[0]?.shortage_lines || 0),
        shortage_period: { from: period.from, to: period.to },
        product_sales_scope: 'Se muestra ingreso agregado marcado PRODUCTO en caja; no hay detalle normalizado de unidades por producto.',
      },
      team: { active_members: Number(team.rows[0]?.active_members || 0) },
      definitions: {
        appointments: 'Reservas lógicas por fecha de inicio; cada grupo de servicios cuenta una sola vez.',
        completed_clients: 'Clientes distintos con al menos una reserva COMPLETADA en el período; se excluyen reservas sin cliente vinculado.',
        repeat_clients: 'Clientes con dos o más reservas lógicas COMPLETADAS dentro del mismo período.',
        completion_rate: 'Reservas lógicas COMPLETADAS / reservas lógicas totales del período.',
        occupancy_rate: 'Minutos reservados sin cancelación / minutos disponibles según horario semanal de prestadores activos.',
        net_cash: 'Ingresos menos gastos del libro de caja, agrupados por moneda.',
        low_stock_items: 'Artículos activos cuyo stock actual es menor o igual al mínimo configurado, al consultar.',
      },
    };
  });
}

module.exports = { getBusinessAnalytics, resolvePeriod, capacityMinutes };

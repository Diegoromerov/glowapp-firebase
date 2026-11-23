const mockClient = { query: jest.fn() };

jest.mock('../config/db', () => ({ pool: {} }));
jest.mock('../config/tenantRouting', () => ({
  runAsSystem: jest.fn((_deps, fn) => fn(mockClient)),
}));

const { getBusinessAnalytics, resolvePeriod } = require('../services/saasBusinessAnalyticsService');
const tenantRouting = require('../config/tenantRouting');

function resetQueries() {
  mockClient.query.mockImplementation(async (sql) => {
    if (sql.includes('WITH primary_bookings')) return { rows: [{ total: 4, completed: 3, cancelled: 1, no_show: 0 }] };
    if (sql.includes('reserved_minutes')) return { rows: [{ reserved_minutes: '120' }] };
    if (sql.includes('completed_by_client')) return { rows: [{ clients: 2, repeat_clients: 1 }] };
    if (sql.includes('JOIN caja_movimientos')) return { rows: [{ currency: 'COP', income: '100000', expenses: '30000', service_income: '80000', product_income: '20000', movements: 3 }] };
    if (sql.includes('JOIN inventario_salon')) return { rows: [{ low_stock_items: 2, active_products: 4 }] };
    if (sql.includes('FROM memberships')) return { rows: [{ active_members: 3 }] };
    if (sql.includes('FROM services s')) return { rows: [{ id: 10, weekly_schedule: { lunes: { activo: true, inicio: 9, fin: 17 } }, active_start_hour: 9, active_end_hour: 17 }] };
    if (sql.includes('JOIN inventario_consumos_reserva')) return { rows: [{ shortage_lines: 1 }] };
    throw new Error(`Consulta no esperada: ${sql}`);
  });
}

describe('saasBusinessAnalyticsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tenantRouting.runAsSystem.mockImplementation((_deps, fn) => fn(mockClient));
    resetQueries();
  });

  test('construye período calendario Bogotá y limita el rango a 366 días', () => {
    const period = resolvePeriod({ from: '2026-11-23', to: '2026-11-23' }, new Date('2026-11-23T15:00:00Z'));
    expect(period.start.toISOString()).toBe('2026-11-23T05:00:00.000Z');
    expect(period.endExclusive.toISOString()).toBe('2026-11-24T05:00:00.000Z');
    expect(() => resolvePeriod({ from: '2026-02-30' })).toThrow('válidas');
    expect(() => resolvePeriod({ from: '2025-01-01', to: '2026-01-02' })).toThrow('366 días');
  });

  test('devuelve KPIs agregados y calcula ocupación sin retornar identidades', async () => {
    const data = await getBusinessAnalytics({
      tenantId: 'tenant-a', salonId: 7,
      query: { from: '2026-11-23', to: '2026-11-23' },
      now: new Date('2026-11-23T15:00:00Z'),
      db: {},
    });

    expect(data.appointments).toMatchObject({ total: 4, completed: 3, completion_rate: 75, reserved_service_minutes: 120 });
    expect(data.customers).toMatchObject({ completed_clients: 2, repeat_clients: 1, repeat_rate: 50 });
    expect(data.capacity).toMatchObject({ available_minutes: 480, reserved_minutes: 120, occupancy_rate: 25 });
    expect(data.cash.by_currency[0]).toMatchObject({ income: 100000, expenses: 30000, net: 70000, product_income: 20000 });
    expect(data.inventory).toMatchObject({ low_stock_items: 2, active_products: 4, shortage_lines: 1 });
    expect(JSON.stringify(data)).not.toMatch(/client_id|email|nombre_cliente/i);
    for (const call of mockClient.query.mock.calls) {
      if (call[0].includes('FROM bookings')) expect(call[1][0]).toBe('tenant-a');
      if (call[0].includes('JOIN caja_movimientos')) {
        expect(call[1][0]).toBe('tenant-a');
        expect(call[0]).toContain('cm.tenant_id = bp.tenant_id');
        expect(call[0]).toContain('bp.id = $1');
      }
      if (call[0].includes('JOIN inventario_salon')) {
        expect(call[1]).toEqual(['tenant-a', 7]);
        expect(call[0]).toContain('i.tenant_id = bp.tenant_id');
      }
      if (call[0].includes('FROM services s')) expect(call[1]).toEqual(['tenant-a', 7]);
    }
    expect(mockClient.query.mock.calls.some(([sql]) => /salon_miembros/.test(sql))).toBe(false);
  });

  test('rechaza períodos inválidos antes de consultar la base', async () => {
    await expect(getBusinessAnalytics({ tenantId: 'tenant-a', query: { from: '2026-12-01', to: '2026-11-01' } }))
      .rejects.toThrow('posterior');
    expect(mockClient.query).not.toHaveBeenCalled();
  });
});

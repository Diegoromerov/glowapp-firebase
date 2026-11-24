const mockClient = { query: jest.fn() };

jest.mock('../config/db', () => ({ pool: {}, systemPool: {} }));
jest.mock('../config/tenantRouting', () => ({
  runAsSystem: jest.fn((_deps, fn) => fn(mockClient)),
}));

const loyalty = require('../services/salonLoyaltyService');
const tenantRouting = require('../config/tenantRouting');

describe('salonLoyaltyService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tenantRouting.runAsSystem.mockImplementation((_deps, fn) => fn(mockClient));
  });

  test('aplica reglas del salón sobre reservas pagadas sin consultar puntos globales', () => {
    expect(loyalty.computeAward({
      pointsPerCompletedBooking: 20,
      pointsPer1000Cop: 3,
      grossCop: 41650,
    })).toBe(143);
  });

  test('rechaza valores monetarios negativos o reglas fuera de límites', () => {
    expect(() => loyalty.computeAward({ grossCop: -1 })).toThrow('no es válido');
    expect(() => loyalty.computeAward({ pointsPerCompletedBooking: 1000001, grossCop: 1000 }))
      .toThrow('cantidad de puntos no válida');
  });

  test('configura reglas solo en la sede del business_profile activo', async () => {
    mockClient.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM salones')) return { rows: [{ id: 9 }] };
      if (sql.includes('INSERT INTO salon_loyalty_programs')) {
        return { rows: [{ business_profile_id: 'bp-a', salon_id: 9, points_per_completed_booking: 10,
          points_per_1000_cop: 5, is_enabled: true }] };
      }
      throw new Error(`SQL inesperado: ${sql}`);
    });

    const saved = await loyalty.saveProgram({
      businessProfileId: 'bp-a', salonId: 9, actorId: 3,
      input: { pointsPerCompletedBooking: 10, pointsPer1000Cop: 5, isEnabled: true },
    });

    expect(saved.is_enabled).toBe(true);
    expect(mockClient.query.mock.calls[0][1]).toEqual([9, 'bp-a']);
    expect(mockClient.query.mock.calls.some(([sql]) => /points_lots|points_movements\b/.test(sql))).toBe(false);
  });

  test('no activa un programa sin una regla positiva', async () => {
    await expect(loyalty.saveProgram({
      businessProfileId: 'bp-a', salonId: 9, actorId: 3,
      input: { pointsPerCompletedBooking: 0, pointsPer1000Cop: 0, isEnabled: true },
    })).rejects.toMatchObject({ code: 'EARNING_RULE_REQUIRED', status: 400 });
    expect(mockClient.query).not.toHaveBeenCalled();
  });

  test('solo acredita reservas completadas y pagadas de la sede activa', async () => {
    mockClient.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM bookings')) return { rows: [{ id: 'booking-a', client_id: 7,
        business_profile_id: 'bp-a', salon_id: 9, status: 'COMPLETADA', payment_status: 'unpaid', valor_bruto: 50000 }] };
      throw new Error(`No debió continuar: ${sql}`);
    });

    await expect(loyalty.awardCompletedBooking({
      businessProfileId: 'bp-a', salonId: 9, bookingId: 'booking-a', actorId: 3,
    })).rejects.toMatchObject({ code: 'BOOKING_NOT_ELIGIBLE', status: 409 });
    expect(mockClient.query).toHaveBeenCalledTimes(1);
  });

  test('acredita una vez y usa una clave estable para cada reserva', async () => {
    mockClient.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM bookings')) return { rows: [{ id: 'booking-a', client_id: 7,
        business_profile_id: 'bp-a', salon_id: 9, status: 'COMPLETADA', payment_status: 'paid', valor_bruto: '41650' }] };
      if (sql.includes('FROM salon_loyalty_programs')) return { rows: [{ points_per_completed_booking: 20, points_per_1000_cop: 3, is_enabled: true }] };
      if (sql.includes('INSERT INTO salon_loyalty_accounts')) return { rows: [] };
      if (sql.includes('SELECT id FROM salon_loyalty_accounts')) return { rows: [{ id: 'account-a' }] };
      if (sql.includes('INSERT INTO salon_loyalty_movements')) return { rows: [{ id: 'movement-a' }] };
      throw new Error(`SQL inesperado: ${sql}`);
    });

    const result = await loyalty.awardCompletedBooking({
      businessProfileId: 'bp-a', salonId: 9, bookingId: 'booking-a', actorId: 3,
    });

    expect(result).toEqual({ awarded: true, points: 143 });
    const movement = mockClient.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO salon_loyalty_movements'));
    expect(movement[1]).toContain('booking:booking-a:award');
    expect(movement[0]).toContain('ON CONFLICT (account_id, idempotency_key) DO NOTHING');
    expect(movement[0]).not.toMatch(/INSERT INTO points_lots|INSERT INTO points_movements/);
  });

  test('lista únicamente reservas lógicas completadas y pagadas del salón activo', async () => {
    mockClient.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM salones')) return { rows: [{ id: 9 }] };
      if (sql.includes('FROM bookings b')) return { rows: [{ id: 'booking-a', points_awarded: false }] };
      throw new Error(`SQL inesperado: ${sql}`);
    });

    const rows = await loyalty.listEligibleBookings({ businessProfileId: 'bp-a', salonId: 9 });
    expect(rows).toEqual([{ id: 'booking-a', points_awarded: false }]);
    const query = mockClient.query.mock.calls.find(([sql]) => sql.includes('FROM bookings b'));
    expect(query[0]).toContain("b.estado::text = 'COMPLETADA'");
    expect(query[0]).toContain("LOWER(COALESCE(b.payment_status, '')) = 'paid'");
    expect(query[0]).toContain("primary_booking_id");
    expect(query[1]).toEqual(['bp-a', 9]);
  });

  test('consulta el historial de recompensas de la sede sin mezclar salones', async () => {
    mockClient.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM salones')) return { rows: [{ id: 9 }] };
      if (sql.includes('FROM salon_loyalty_reward_audit')) return { rows: [{ reward_id: 'r1', points_cost: 50 }] };
      throw new Error(`SQL inesperado: ${sql}`);
    });
    const rows = await loyalty.listRewardAudit({ businessProfileId: 'bp-a', salonId: 9 });
    expect(rows).toEqual([{ reward_id: 'r1', points_cost: 50 }]);
    expect(mockClient.query.mock.calls[1][1]).toEqual(['bp-a', 9]);
  });

  test('conserva el canje transaccional y no acepta una clave corta', async () => {
    await expect(loyalty.redeem({ salonId: 9, customerUserId: 7, rewardId: 'reward-a', key: 'x' }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED', status: 400 });
    expect(mockClient.query).not.toHaveBeenCalled();
  });
});

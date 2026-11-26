jest.mock('../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../config/database', () => ({
  sequelize: {
    transaction: jest.fn(),
    query: jest.fn(),
    QueryTypes: { SELECT: 'SELECT' },
  },
}));
jest.mock('../config/tenantRouting', () => ({
  runAsSystem: jest.fn(),
}));
jest.mock('../models', () => ({
  Booking: { create: jest.fn() },
  Service: { findAll: jest.fn() },
  User: {},
  Transaction: {},
}));

const { sequelize } = require('../config/database');
const { runAsSystem } = require('../config/tenantRouting');
const { Booking, Service } = require('../models');
const { createBooking } = require('../controllers/bookingController');
const { getProviderSlots } = require('../controllers/providerController');

describe('POST /api/bookings: estado operativo del prestador', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sequelize.transaction.mockImplementation((callback) => callback({}));
    sequelize.query.mockImplementation((sql) => {
      if (sql.includes('SELECT u.is_active, u.estado_operativo')) {
        return Promise.resolve([{
          is_active: true,
          estado_operativo: 'EXPLORACION',
          estatus_verificacion: 'PENDIENTE',
        }]);
      }
      if (sql.includes('information_schema.columns')) return Promise.resolve([]);
      if (sql.includes('SELECT responsable_iva, tarifa_iva')) return Promise.resolve([]);
      return Promise.resolve([]);
    });
    Service.findAll.mockResolvedValue([]);
  });

  test('rechaza antes de insertar la cita cuando el prestador está en Exploración', async () => {
    const req = {
      user: { id: 9001 },
      body: {
        provider_id: '42',
        service_ids: ['00000000-0000-4000-8000-000000000001'],
        scheduled_at: '2026-12-01T15:00:00.000Z',
      },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    await createBooking(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      code: 'PROVIDER_NOT_OPERATIONAL',
    }));
    expect(Booking.create).not.toHaveBeenCalled();
  });

  test('no publica horarios reservables de un prestador en Exploración', async () => {
    runAsSystem.mockImplementation((_context, callback) => callback({
      query: jest.fn().mockResolvedValue({
        rows: [{
          is_active: true,
          estado_operativo: 'EXPLORACION',
          estatus_verificacion: 'PENDIENTE',
        }],
      }),
    }));
    const req = {
      params: { id: '42' },
      query: {
        date: '2026-12-01',
        service_id: '00000000-0000-4000-8000-000000000001',
      },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    await getProviderSlots(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      code: 'PROVIDER_NOT_OPERATIONAL',
    }));
  });

  test('usa el horario comercial del salón aunque el usuario no tenga perfil_prestador', async () => {
    const salonHours = {
      lunes: { open: true, start: '09:00', end: '18:00' },
      martes: { open: true, start: '09:00', end: '18:00' },
      miercoles: { open: true, start: '09:00', end: '18:00' },
      jueves: { open: true, start: '09:00', end: '18:00' },
      viernes: { open: true, start: '09:00', end: '18:00' },
      sabado: { open: true, start: '10:00', end: '14:00' },
      domingo: { open: false },
    };
    runAsSystem.mockImplementation((_context, callback) => callback({
      query: jest.fn(async (sql) => {
        if (sql.includes('SELECT u.is_active, u.estado_operativo')) return { rows: [{
          is_active: true, estado_operativo: 'HABILITADO', estatus_verificacion: null,
        }] };
        if (sql.includes('SELECT SUM(duration_minutes)')) return { rows: [{
          total_duration: '30', match_count: '1', unresolved_scope_count: '0',
          service_salon_ids: [17], business_profile_ids: [],
        }] };
        if (sql.includes('SELECT id, business_profile_id FROM salones')) return { rows: [{
          id: 17, business_profile_id: null,
        }] };
        if (sql.includes('SELECT b.scheduled_at')) return { rows: [] };
        if (sql.includes('requested.provider_id')) return { rows: [{
          active_start_hour: null, active_end_hour: null, weekly_schedule: null,
          horario_atencion: salonHours,
        }] };
        throw new Error(`Unexpected query in slots test: ${sql}`);
      }),
    }));

    const requestSlots = async (date) => {
      const req = {
        params: { id: '132' },
        query: { date, service_id: '00000000-0000-4000-8000-000000000001', salon_id: '17' },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
      await getProviderSlots(req, res);
      return res.json.mock.calls[0][0];
    };

    const friday = await requestSlots('2026-11-27');
    expect(friday.slots[0].time).toBe('09:00');
    expect(friday.slots.at(-1).time).toBe('17:30');

    const saturday = await requestSlots('2026-11-28');
    expect(saturday.slots[0].time).toBe('10:00');
    expect(saturday.slots.at(-1).time).toBe('13:30');

    const sunday = await requestSlots('2026-11-29');
    expect(sunday.slots).toEqual([]);
  });
});

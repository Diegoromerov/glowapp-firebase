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

const { pool } = require('../config/db');
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

  test('no revela horarios de una sede privada al catálogo de clientes', async () => {
    runAsSystem.mockImplementation((_context, callback) => callback({
      query: jest.fn(async (sql) => {
        if (sql.includes('SELECT u.is_active, u.estado_operativo')) return { rows: [{
          is_active: true, estado_operativo: 'HABILITADO', estatus_verificacion: 'APROBADO',
        }] };
        if (sql.includes('SELECT SUM(duration_minutes)')) return { rows: [{
          total_duration: '30', match_count: '1', unresolved_scope_count: '0',
          service_salon_ids: [17], business_profile_ids: [],
        }] };
        if (sql.includes('SELECT s.id, s.business_profile_id')) return { rows: [{
          id: 17, business_profile_id: null, location_enabled: false,
          location_public: false, plan_saas: 'FREE_TRIAL',
        }] };
        if (sql.includes('SELECT b.scheduled_at')) return { rows: [] };
        if (sql.includes('requested.provider_id')) return { rows: [{
          active_start_hour: null, active_end_hour: null, weekly_schedule: null,
          horario_atencion: { viernes: { open: true, start: '09:00', end: '18:00' } },
        }] };
        throw new Error(`Unexpected query in private salon slots test: ${sql}`);
      }),
    }));
    const req = {
      appAudience: 'client',
      params: { id: '132' },
      query: {
        date: '2026-11-27',
        service_id: '00000000-0000-4000-8000-000000000001',
        salon_id: '17',
      },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    await getProviderSlots(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      code: 'SALON_NOT_PUBLIC',
    }));
  });

  test('rechaza crear una reserva de marketplace para una sede privada', async () => {
    sequelize.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT u.is_active, u.estado_operativo')) return [{
        is_active: true, estado_operativo: 'HABILITADO', estatus_verificacion: 'APROBADO',
      }];
      if (sql.includes('information_schema.columns')) return [];
      if (sql.includes('SELECT responsable_iva, tarifa_iva')) return [];
      if (sql.includes('SELECT id FROM business_profiles')) return [];
      if (sql.includes('SELECT s.id, s.business_profile_id')) return [{
        id: 17, business_profile_id: null, location_enabled: false,
        location_public: false, plan_saas: 'FREE_TRIAL',
      }];
      if (sql.includes('SELECT s.location_enabled')) return [{
        location_enabled: false, location_public: false, plan_saas: 'FREE_TRIAL',
      }];
      return [];
    });
    Service.findAll.mockResolvedValue([{
      id: '00000000-0000-4000-8000-000000000001',
      provider_id: 132,
      business_profile_id: null,
      salon_id: 17,
      price: '100000',
      duration_minutes: 30,
    }]);
    const req = {
      appAudience: 'client',
      user: { id: 9002 },
      body: {
        provider_id: '132',
        salon_id: '17',
        service_ids: ['00000000-0000-4000-8000-000000000001'],
        scheduled_at: '2026-11-27T14:00:00.000Z',
      },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    await createBooking(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      code: 'SALON_NOT_PUBLIC',
    }));
    expect(Booking.create).not.toHaveBeenCalled();
  });

  test('crea una reserva para una sede pública usando su horario', async () => {
    const salonHours = {
      lunes: { open: true, start: '09:00', end: '18:00' },
      martes: { open: true, start: '09:00', end: '18:00' },
      miercoles: { open: true, start: '09:00', end: '18:00' },
      jueves: { open: true, start: '09:00', end: '18:00' },
      viernes: { open: true, start: '09:00', end: '18:00' },
      sabado: { open: true, start: '10:00', end: '14:00' },
      domingo: { open: false },
    };
    sequelize.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT u.is_active, u.estado_operativo')) return [{
        is_active: true, estado_operativo: 'HABILITADO', estatus_verificacion: 'APROBADO',
      }];
      if (sql.includes('information_schema.columns')) return [];
      if (sql.includes('SELECT responsable_iva, tarifa_iva')) return [];
      if (sql.includes('SELECT id FROM business_profiles')) return [];
      if (sql.includes('SELECT s.id, s.business_profile_id')) return [{
        id: 17, business_profile_id: null, location_enabled: true,
        location_public: true, plan_saas: 'FREE_TRIAL',
      }];
      if (sql.includes('SELECT s.location_enabled')) return [{
        location_enabled: true, location_public: true, plan_saas: 'FREE_TRIAL',
      }];
      if (sql.includes('requested.provider_id')) return [{
        active_start_hour: null, active_end_hour: null, weekly_schedule: null,
        horario_atencion: salonHours,
      }];
      return [];
    });
    Service.findAll.mockResolvedValue([{
      id: '00000000-0000-4000-8000-000000000001',
      provider_id: 132,
      business_profile_id: null,
      salon_id: 17,
      price: '100000',
      duration_minutes: 30,
    }]);
    Booking.create.mockResolvedValue({ id: 'qa-booking-id', estado: 'PENDIENTE_PAGO' });
    pool.query.mockResolvedValue({ rows: [] });
    const req = {
      appAudience: 'client',
      user: { id: 9002 },
      body: {
        provider_id: '132',
        salon_id: '17',
        service_ids: ['00000000-0000-4000-8000-000000000001'],
        scheduled_at: '2026-11-27T14:00:00.000Z',
      },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    await createBooking(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      booking_id: 'qa-booking-id',
    }));
    expect(Booking.create).toHaveBeenCalledWith(expect.objectContaining({
      salon_id: 17,
      estado: 'PENDIENTE_PAGO',
    }), expect.anything());
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
        if (sql.includes('SELECT s.id, s.business_profile_id')) return { rows: [{
          id: 17, business_profile_id: null, location_enabled: true,
          location_public: true, plan_saas: 'FREE_TRIAL',
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
        appAudience: 'client',
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

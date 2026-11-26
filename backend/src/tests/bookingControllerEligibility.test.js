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
});

'use strict';

jest.mock('../config/db', () => ({
  pool: { query: jest.fn() },
  getDbStatus: () => ({ servingFabricatedData: false }),
}));
jest.mock('../config/tenantRouting', () => ({
  runAsSystem: (_deps, callback) => callback({ query: _deps.pool.query }),
}));

const db = require('../config/db');
const { getProviders } = require('../controllers/providerController');

describe('live provider positions in client map search', () => {
  beforeEach(() => db.pool.query.mockReset());

  test('uses only consented online fixes fresh within five minutes and returns source metadata', async () => {
    const capturedAt = new Date();
    db.pool.query
      .mockResolvedValueOnce({ rows: [{
        id: '42',
        full_name: 'Prestador de prueba',
        avatar_url: '',
        business_name: 'Prueba',
        description: '',
        rating_avg: 4.8,
        rating_count: 3,
        is_verified: true,
        can_receive_bookings: true,
        is_salon: false,
        longitude: -74.1,
        latitude: 4.7,
        registered_longitude: -74.05,
        registered_latitude: 4.65,
        is_live_location: true,
        live_location_updated_at: capturedAt,
        loyalty_tier: 'Creative Edge',
        start_hour: null,
        end_hour: null,
        weekly_schedule: null,
        distance_meters: 125,
      }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    await getProviders({
      user: { role: 'client' },
      query: { lat: '4.7', lon: '-74.1', radius: '20000' },
    }, res);

    const sql = db.pool.query.mock.calls[0][0];
    expect(sql).toContain('LEFT JOIN provider_live_locations live');
    expect(sql).toContain('p.live_location_consent = true');
    expect(sql).toContain("live.captured_at >= NOW() - INTERVAL '5 minutes'");
    expect(sql).toContain('COALESCE(live.location, p.ubicacion)');
    expect(db.pool.query.mock.calls[0][1][4]).toBe(true);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        id: '42',
        latitude: 4.7,
        longitude: -74.1,
        registered_latitude: 4.65,
        registered_longitude: -74.05,
        is_live_location: true,
        live_location_updated_at: capturedAt,
      })],
    }));
  });

  test('does not request live coordinates for anonymous map browsing', async () => {
    db.pool.query
      .mockResolvedValueOnce({ rows: [] });
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await getProviders({ query: { lat: '4.7', lon: '-74.1', radius: '20000' } }, res);

    expect(db.pool.query.mock.calls[0][0]).toContain('AND $5::boolean = true');
    expect(db.pool.query.mock.calls[0][1][4]).toBe(false);
    expect(res.json.mock.calls[0][0].data).toEqual([]);
  });

  test('fails closed instead of returning fabricated coordinates when spatial query fails', async () => {
    db.pool.query.mockRejectedValueOnce(new Error('PostGIS unavailable'));
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await getProviders({ query: { lat: '4.7', lon: '-74.1', radius: '20000' } }, res);

    expect(db.pool.query).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'PROVIDER_LOCATION_UNAVAILABLE',
    }));
    expect(res.json.mock.calls[0][0]).not.toHaveProperty('data');
  });
});

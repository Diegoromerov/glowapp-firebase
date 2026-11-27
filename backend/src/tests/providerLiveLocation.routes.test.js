'use strict';

jest.mock('../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../middleware/auth', () => ({
  authMiddleware: (req, res, next) => {
    req.user = global.__providerLocationTestUser || { id: 42, role: 'provider' };
    next();
  },
}));

const express = require('express');
const request = require('supertest');
const { pool } = require('../config/db');
const providerRoutes = require('../routes/providerRoutes');

const app = express();
app.use(express.json());
app.use('/api', providerRoutes);

describe('provider live location endpoints', () => {
  beforeEach(() => {
    pool.query.mockReset();
    global.__providerLocationTestUser = { id: 42, role: 'provider' };
  });

  afterAll(() => {
    delete global.__providerLocationTestUser;
  });

  test('accepts explicit location consent and deletes the current fix on revoke', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ live_location_consent: true }] })
      .mockResolvedValueOnce({ rows: [{ live_location_consent: false }] })
      .mockResolvedValueOnce({ rows: [] });

    const enabled = await request(app)
      .put('/api/provider/me/location-consent')
      .send({ enabled: true });
    expect(enabled.status).toBe(200);
    expect(enabled.body).toEqual({ enabled: true });

    const revoked = await request(app)
      .put('/api/provider/me/location-consent')
      .send({ enabled: false });
    expect(revoked.status).toBe(200);
    expect(pool.query.mock.calls[2][0]).toContain('DELETE FROM provider_live_locations');
    expect(pool.query.mock.calls[2][1]).toEqual([42]);
  });

  test('accepts a recent precise fix and derives provider identity from auth', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ provider_id: 42 }] });
    const response = await request(app)
      .put('/api/provider/me/live-location')
      .send({
        latitude: 4.65,
        longitude: -74.1,
        accuracy_meters: 12,
        captured_at: new Date().toISOString(),
      });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(pool.query.mock.calls[0][0]).toContain('p.is_active = TRUE AND p.live_location_consent = TRUE');
    expect(pool.query.mock.calls[0][1][0]).toBe(42);
  });

  test.each([
    [{ latitude: 91, longitude: 0, accuracy_meters: 1 }, 'invalid latitude'],
    [{ latitude: 4, longitude: 0, accuracy_meters: 101 }, 'poor accuracy'],
    [{ latitude: 4, longitude: 0, accuracy_meters: 1, captured_at: 'invalid' }, 'invalid timestamp'],
    [{ latitude: 4, longitude: 0, accuracy_meters: 1, captured_at: Date.now() }, 'non-string timestamp'],
    [{ latitude: 4, longitude: 0, accuracy_meters: 1, captured_at: new Date(Date.now() - 120000).toISOString() }, 'stale fix'],
  ])('rejects %s', async (body) => {
    const response = await request(app)
      .put('/api/provider/me/live-location')
      .send({
        longitude: -74,
        captured_at: new Date().toISOString(),
        ...body,
      });

    expect(response.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('rejects non-provider identities', async () => {
    global.__providerLocationTestUser = { id: 9, role: 'client' };
    const response = await request(app)
      .put('/api/provider/me/live-location')
      .send({
        latitude: 4,
        longitude: -74,
        accuracy_meters: 1,
        captured_at: new Date().toISOString(),
      });

    expect(response.status).toBe(403);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

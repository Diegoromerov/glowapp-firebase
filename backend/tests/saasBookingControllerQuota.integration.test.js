// Exercise the real booking controller, Sequelize transaction, quota service,
// and booking insert against PostgreSQL/RLS fixtures created for CI only.
const crypto = require('crypto');
const { Pool } = require('pg');
const { sequelize } = require('../src/config/database');
const { Booking } = require('../src/models');
const { createBooking } = require('../src/controllers/bookingController');
const { getMonthPeriod } = require('../src/config/saasCatalog');
const { runAsSystemContext } = require('../src/config/tenantRouting');

const ADMIN_URL = process.env.DATABASE_URL_ADMIN;
const APP_URL = process.env.DATABASE_URL;
const describeWithPostgres = ADMIN_URL && APP_URL ? describe : describe.skip;

describeWithPostgres('SaaS booking quota through the controller on PostgreSQL/RLS', () => {
  let adminPool;
  let verticalId;
  let providerId;
  let clientId;
  let profileId;
  let salonId;
  let serviceId;
  let period;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    verticalId = crypto.randomUUID();
    profileId = crypto.randomUUID();
    const suffix = crypto.randomUUID();
    await adminPool.query(
      'INSERT INTO business_verticals (id, code, name, description) VALUES ($1, $2, $3, $4)',
      [verticalId, `BOOKING_E2E_${verticalId}`, 'Booking controller test', 'Ephemeral CI fixture']
    );

    const provider = await adminPool.query(
      `INSERT INTO usuarios
         (email, password_hash, nombre, auth_provider, provider_id, rol, tenant_id,
          onboarding_completo, is_active, estado_operativo, responsable_iva, tarifa_iva)
       VALUES ($1, $2, $3, 'LOCAL', $1, 'PRESTADOR', 1, true, true, 'HABILITADO', false, 0)
       RETURNING id`,
      [`quota-provider-${suffix}@test.local`, 'integration-test-only', 'Quota provider']
    );
    providerId = provider.rows[0].id;

    const client = await adminPool.query(
      `INSERT INTO usuarios
         (email, password_hash, nombre, auth_provider, provider_id, rol, tenant_id, is_active)
       VALUES ($1, $2, $3, 'LOCAL', $1, 'CLIENTE', 1, true)
       RETURNING id`,
      [`quota-client-${suffix}@test.local`, 'integration-test-only', 'Quota client']
    );
    clientId = client.rows[0].id;

    await adminPool.query(
      `INSERT INTO perfiles_prestador
         (id, business_name, estatus_verificacion, is_active, active_start_hour, active_end_hour)
       VALUES ($1, 'Quota provider', 'APROBADO', true, 6, 20)`,
      [providerId]
    );
    await adminPool.query(
      `INSERT INTO business_profiles (id, provider_id, vertical_id, name, tenant_id, saas_plan)
       VALUES ($1, $2, $3, 'Quota provider', $1, 'FREEMIUM')`,
      [profileId, providerId, verticalId]
    );

    const hours = Object.fromEntries(
      ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']
        .map((day) => [day, { open: true, start: '06:00', end: '20:00' }])
    );
    const salon = await adminPool.query(
      `INSERT INTO salones
         (id_dueno, nombre_salon, business_profile_id, plan_saas, tenant_id,
          location_enabled, location_public, horario_atencion)
       VALUES ($1, 'Quota provider', $2, 'FREEMIUM', 1, true, true, $3::jsonb)
       RETURNING id`,
      [providerId, profileId, JSON.stringify(hours)]
    );
    salonId = salon.rows[0].id;

    const service = await adminPool.query(
      `INSERT INTO services
         (id, provider_id, name, price, duration_minutes, tenant_id,
          business_profile_id, salon_id, is_active)
       VALUES ($1, $2, 'Quota test service', 25000, 30, 1, $3, $4, true)
       RETURNING id`,
      [crypto.randomUUID(), providerId, profileId, salonId]
    );
    serviceId = service.rows[0].id;
    period = getMonthPeriod();

    await adminPool.query(
      `INSERT INTO usage_metrics (tenant_id, feature, period_start, period_end, count, "limit")
       VALUES ($1, 'DIRECT_BOOKINGS', $2, $3, 29, 30)`,
      [profileId, period.start, period.end]
    );
  });

  afterAll(async () => {
    if (adminPool) {
      if (profileId) {
        await adminPool.query('DELETE FROM bookings WHERE business_profile_id = $1', [profileId]);
        await adminPool.query(
          `DELETE FROM usage_metrics WHERE tenant_id = $1 AND feature = 'DIRECT_BOOKINGS'`,
          [profileId]
        );
      }
      if (serviceId) await adminPool.query('DELETE FROM services WHERE id = $1', [serviceId]);
      if (salonId) await adminPool.query('DELETE FROM salones WHERE id = $1', [salonId]);
      if (profileId) await adminPool.query('DELETE FROM business_profiles WHERE id = $1', [profileId]);
      if (providerId) await adminPool.query('DELETE FROM perfiles_prestador WHERE id = $1', [providerId]);
      if (clientId) await adminPool.query('DELETE FROM usuarios WHERE id = $1', [clientId]);
      if (providerId) await adminPool.query('DELETE FROM usuarios WHERE id = $1', [providerId]);
      if (verticalId) await adminPool.query('DELETE FROM business_verticals WHERE id = $1', [verticalId]);
      await adminPool.end();
    }
  });

  function scheduledAt(daysAhead) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + daysAhead);
    date.setUTCHours(17, 0, 0, 0); // 12:00 en Bogotá.
    return date.toISOString();
  }

  async function submit({ audience = 'provider', daysAhead, failBookingInsert = false }) {
    const originalCreate = Booking.create;
    if (failBookingInsert) {
      Booking.create = async (values, options) => originalCreate.call(
        Booking,
        { ...values, estado: 'INVALID_BOOKING_STATE' },
        options
      );
    }

    const res = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    try {
      await runAsSystemContext(() => createBooking({
          appAudience: audience,
          user: { id: clientId, tenant_id: 1 },
          body: {
            provider_id: String(providerId),
            salon_id: String(salonId),
            service_ids: [serviceId],
            scheduled_at: scheduledAt(daysAhead),
          },
        }, res));
    } finally {
      Booking.create = originalCreate;
    }
    return res;
  }

  async function currentUsage() {
    const result = await adminPool.query(
      `SELECT count FROM usage_metrics
        WHERE tenant_id = $1 AND feature = 'DIRECT_BOOKINGS' AND period_start = $2`,
      [profileId, period.start]
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  test('booking insert failure rolls back the quota reserved by the controller transaction', async () => {
    const response = await submit({ daysAhead: 4, failBookingInsert: true });
    expect(response.statusCode).toBe(500);
    expect(await currentUsage()).toBe(29);
    const bookings = await adminPool.query('SELECT id FROM bookings WHERE business_profile_id = $1', [profileId]);
    expect(bookings.rows).toHaveLength(0);
  }, 30000);

  test('direct booking consumes the last slot, rejects the next, and marketplace booking consumes none', async () => {
    const direct = await submit({ audience: 'provider', daysAhead: 4 });
    expect(direct.statusCode).toBe(200);
    expect(direct.body).toMatchObject({ success: true });
    expect(await currentUsage()).toBe(30);

    const overLimit = await submit({ audience: 'provider', daysAhead: 5 });
    expect(overLimit.statusCode).toBe(429);
    expect(overLimit.body).toMatchObject({ code: 'SAAS_QUOTA_EXCEEDED', current: 30, limit: 30 });
    expect(await currentUsage()).toBe(30);

    const marketplace = await submit({ audience: 'client', daysAhead: 6 });
    expect(marketplace.statusCode).toBe(200);
    expect(marketplace.body).toMatchObject({ success: true });
    expect(await currentUsage()).toBe(30);

    const bookings = await adminPool.query(
      `SELECT productos_adicionales->>'booking_origin' AS origin
         FROM bookings WHERE business_profile_id = $1 ORDER BY scheduled_at`,
      [profileId]
    );
    expect(bookings.rows.map((row) => row.origin)).toEqual(['SALON_DIRECT', 'MARKETPLACE']);
  }, 30000);
});

const express = require('express');
const request = require('supertest');
const catalogRoutes = require('../saasCatalogRoutes');

const app = express();
app.use('/api/saas/catalog', catalogRoutes);

const BILLING_ENV_KEYS = [
  'NODE_ENV',
  'WOMPI_SAAS_BILLING_ENABLED',
  'WOMPI_SAAS_COF_ENABLED',
  'WOMPI_SAAS_SANDBOX_ENABLED',
  'WOMPI_SAAS_BASE_URL',
  'WOMPI_SAAS_PUBLIC_KEY',
  'WOMPI_SAAS_PRIVATE_KEY',
  'WOMPI_SAAS_INTEGRITY_SECRET',
  'WOMPI_SAAS_EVENTS_SECRET',
  'WOMPI_SAAS_ENCRYPTION_KEY',
];

describe('SaaS public catalog checkout status', () => {
  let previousEnv;

  beforeEach(() => {
    previousEnv = Object.fromEntries(BILLING_ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of BILLING_ENV_KEYS) delete process.env[key];
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    for (const key of BILLING_ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  });

  it('reports checkout paused when the SaaS payment account is not configured', async () => {
    const response = await request(app).get('/api/saas/catalog');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.checkoutAvailable).toBe(false);
    expect(response.body.plans.find((plan) => plan.id === 'BASIC').commerciallyAvailable).toBe(true);
  });

  it('reports checkout availability only when sandbox prerequisites are complete outside production', async () => {
    Object.assign(process.env, {
      WOMPI_SAAS_BILLING_ENABLED: 'true',
      WOMPI_SAAS_COF_ENABLED: 'true',
      WOMPI_SAAS_SANDBOX_ENABLED: 'true',
      WOMPI_SAAS_BASE_URL: 'https://sandbox.wompi.co/v1',
      WOMPI_SAAS_PUBLIC_KEY: 'pub_test_catalog',
      WOMPI_SAAS_PRIVATE_KEY: 'prv_test_catalog',
      WOMPI_SAAS_INTEGRITY_SECRET: 'test_integrity_catalog',
      WOMPI_SAAS_EVENTS_SECRET: 'test_events_catalog',
      WOMPI_SAAS_ENCRYPTION_KEY: 'sandbox-encryption-key',
    });

    const response = await request(app).get('/api/saas/catalog/BASIC');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.checkoutAvailable).toBe(true);
  });

  it('never reports sandbox checkout as available in production', async () => {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      WOMPI_SAAS_BILLING_ENABLED: 'true',
      WOMPI_SAAS_COF_ENABLED: 'true',
      WOMPI_SAAS_SANDBOX_ENABLED: 'true',
      WOMPI_SAAS_BASE_URL: 'https://sandbox.wompi.co/v1',
      WOMPI_SAAS_PUBLIC_KEY: 'pub_test_catalog',
      WOMPI_SAAS_PRIVATE_KEY: 'prv_test_catalog',
      WOMPI_SAAS_INTEGRITY_SECRET: 'test_integrity_catalog',
      WOMPI_SAAS_EVENTS_SECRET: 'test_events_catalog',
      WOMPI_SAAS_ENCRYPTION_KEY: 'sandbox-encryption-key',
    });

    const response = await request(app).get('/api/saas/catalog');

    expect(response.status).toBe(200);
    expect(response.body.checkoutAvailable).toBe(false);
  });
});

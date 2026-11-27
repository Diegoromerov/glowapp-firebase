const express = require('express');
const request = require('supertest');

const mockPool = { query: jest.fn() };
const mockWompiSaasBilling = {
  isCheckoutAvailable: jest.fn(),
  startCheckout: jest.fn(),
};
const mockStripeService = {
  isConfigured: jest.fn(),
  createOrGetCustomer: jest.fn(),
  createCheckoutSession: jest.fn(),
};
const mockSubscriptionService = {
  getActiveSubscription: jest.fn(),
  _getStripePriceId: jest.fn(),
  changePlan: jest.fn(),
};

jest.mock('../src/config/db', () => ({ pool: mockPool, systemPool: mockPool }));
jest.mock('../src/middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.user = { id: 73, email: 'owner@example.test' };
    next();
  },
}));
jest.mock('../src/middleware/saasContext', () => (req, _res, next) => {
  req.saas = { tenantId: 'billing-qa-tenant', name: 'QA Salon', plan: 'FREEMIUM' };
  next();
});
jest.mock('../src/middleware/featureGate', () => ({
  requireEntitlement: () => (_req, _res, next) => next(),
  requireOwner: (_req, _res, next) => next(),
}));
jest.mock('../src/services/wompiSaasBillingService', () => mockWompiSaasBilling);
jest.mock('../src/services/stripeService', () => mockStripeService);
jest.mock('../src/services/subscriptionService', () => mockSubscriptionService);
jest.mock('../src/services/invoiceService', () => ({
  getInvoiceDocument: jest.fn(),
  getInvoicesByTenant: jest.fn(),
  getPlanPrice: jest.fn(),
}));

const router = require('../src/routes/saasBillingRoutes');

describe('SaaS billing production fail-closed behavior', () => {
  let app;
  let originalWebhookSecret;

  beforeEach(() => {
    jest.clearAllMocks();
    originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    mockWompiSaasBilling.isCheckoutAvailable.mockReturnValue(false);
    mockStripeService.isConfigured.mockReturnValue(false);
    mockSubscriptionService._getStripePriceId.mockReturnValue(null);
    app = express();
    app.use(express.json());
    app.use('/api/saas/billing', router);
  });

  afterEach(() => {
    if (originalWebhookSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = originalWebhookSecret;
  });

  test('no inicia checkout COP ni llama a Wompi cuando el producto recurrente no está habilitado', async () => {
    const response = await request(app)
      .post('/api/saas/billing/checkout')
      .send({ plan: 'BASIC', currency: 'COP', paymentToken: 'tok_test_123' });

    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/Wompi está deshabilitado/i);
    expect(mockWompiSaasBilling.startCheckout).not.toHaveBeenCalled();
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  test('no inicia checkout USD sin secreto de webhook, incluso si Stripe tiene credenciales', async () => {
    mockStripeService.isConfigured.mockReturnValue(true);

    const response = await request(app)
      .post('/api/saas/billing/checkout')
      .send({ plan: 'BASIC', currency: 'USD' });

    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/confirmar pagos de forma segura/i);
    expect(mockStripeService.createOrGetCustomer).not.toHaveBeenCalled();
    expect(mockStripeService.createCheckoutSession).not.toHaveBeenCalled();
  });

  test('no aplica cambios directos de plan antes de una confirmación de pago', async () => {
    const response = await request(app)
      .post('/api/saas/billing/change-plan')
      .send({ plan: 'BASIC' });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/confirmarse por webhook/i);
    expect(mockSubscriptionService.changePlan).not.toHaveBeenCalled();
    expect(mockPool.query).not.toHaveBeenCalled();
  });
});

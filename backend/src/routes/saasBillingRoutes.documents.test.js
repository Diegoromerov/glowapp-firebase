jest.mock('../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../middleware/auth', () => ({ authMiddleware: (req, _res, next) => next() }));
jest.mock('../middleware/saasContext', () => (req, _res, next) => {
  req.saas = { tenantId: 'tenant-qa', name: 'QA Salon', plan: 'BASIC' };
  next();
});
jest.mock('../middleware/featureGate', () => ({
  requireEntitlement: () => (_req, _res, next) => next(),
  requireOwner: (_req, _res, next) => next()
}));
jest.mock('../services/subscriptionService', () => ({}));
jest.mock('../services/stripeService', () => ({}));
jest.mock('../services/invoiceService', () => ({
  getInvoiceDocument: jest.fn(),
  getInvoicesByTenant: jest.fn()
}));

const express = require('express');
const request = require('supertest');
const { pool } = require('../config/db');
const invoiceService = require('../services/invoiceService');
const billingRouter = require('./saasBillingRoutes');

describe('SaaS invoice document route', () => {
  const app = express();
  app.use('/api/saas/billing', billingRouter);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('queries the invoice within the active tenant and serves private, uncached PDF bytes', async () => {
    const pdf = Buffer.from('%PDF-1.7 private receipt');
    pool.query.mockResolvedValue({ rows: [{ invoice_number: 'INV-202611-0001' }] });
    invoiceService.getInvoiceDocument.mockResolvedValue({
      buffer: pdf,
      contentType: 'application/pdf',
      extension: 'pdf'
    });

    const response = await request(app).get('/api/saas/billing/invoices/invoice-uuid/pdf');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['content-disposition']).toContain('INV-202611-0001.pdf');
    expect(response.body).toEqual(pdf);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id = $1 AND tenant_id = $2'),
      ['invoice-uuid', 'tenant-qa']
    );
    expect(invoiceService.getInvoiceDocument).toHaveBeenCalledWith('tenant-qa', 'INV-202611-0001');
  });

  it('does not fetch an artifact when the invoice belongs to another tenant or is absent', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const response = await request(app).get('/api/saas/billing/invoices/foreign-invoice/pdf');

    expect(response.status).toBe(404);
    expect(invoiceService.getInvoiceDocument).not.toHaveBeenCalled();
  });

  it('returns an authenticated download path with each invoice in the list', async () => {
    invoiceService.getInvoicesByTenant.mockResolvedValue([{
      id: 'invoice-uuid', invoice_number: 'INV-202611-0001', status: 'paid',
      currency: 'COP', subtotal: 100000, tax: 19000, total: 119000,
      amount_paid: 119000, items: []
    }]);

    const response = await request(app).get('/api/saas/billing/invoices');

    expect(response.status).toBe(200);
    expect(response.body.invoices[0].pdfUrl).toBe('/api/saas/billing/invoices/invoice-uuid/pdf');
    expect(invoiceService.getInvoicesByTenant).toHaveBeenCalledWith('tenant-qa', {
      limit: 50, offset: 0, status: undefined
    });
  });
});

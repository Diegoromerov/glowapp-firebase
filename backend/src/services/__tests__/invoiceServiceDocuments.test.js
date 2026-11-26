jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../invoiceDocumentStorage', () => ({
  storeInvoiceDocument: jest.fn(async document => ({ storage: 'test', ...document })),
  loadInvoiceDocument: jest.fn()
}));

const invoiceDocumentStorage = require('../invoiceDocumentStorage');
const invoiceService = require('../invoiceService');

describe('invoiceService document generation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('generates a valid PDF receipt and stores it against the invoice tenant', async () => {
    const invoice = {
      tenant_id: 'salon-17',
      invoice_number: 'INV-202611-0001',
      status: 'paid',
      currency: 'COP',
      subtotal: '84033.61',
      tax: '15966.39',
      total: '100000',
      amount_paid: '100000',
      period_start: '2026-11-01T00:00:00.000Z',
      period_end: '2026-11-30T23:59:59.000Z',
      due_date: '2026-12-05T00:00:00.000Z',
      created_at: '2026-11-01T00:00:00.000Z',
      items: [{ description: 'Suscripción SaaS', quantity: 1, unit_price: '84033.61', tax_rate: 0.19, total: '100000' }]
    };

    await invoiceService.generateInvoicePDF(invoice, {
      name: 'Salón QA', owner_email: 'qa@example.com', address: '', tax_id: ''
    });

    const stored = invoiceDocumentStorage.storeInvoiceDocument.mock.calls[0][0];
    expect(stored.tenantId).toBe('salon-17');
    expect(stored.invoiceNumber).toBe('INV-202611-0001');
    expect(stored.contentType).toBe('application/pdf');
    expect(stored.buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('does not apply the COP tax calculation to a USD payment event', async () => {
    const insertedInvoice = {
      tenant_id: 'salon-17',
      invoice_number: 'INV-202611-0002',
      status: 'paid',
      currency: 'USD',
      subtotal: 100,
      tax: 0,
      total: 100,
      amount_paid: 100,
      period_start: '2026-11-01T00:00:00.000Z',
      period_end: '2026-11-30T23:59:59.000Z',
      due_date: '2026-12-05T00:00:00.000Z',
      created_at: '2026-11-01T00:00:00.000Z',
      items: [{ description: 'Suscripción SaaS', quantity: 1, unit_price: 100, tax_rate: 0, total: 100 }]
    };
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'salon-17', name: 'Salón QA', owner_email: 'qa@example.com' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [insertedInvoice] }) };

    await invoiceService.createInvoiceFromSubscription(client, {
      id: 13,
      tenant_id: 'salon-17',
      plan: 'BASIC',
      currency: 'USD',
      current_period_start: insertedInvoice.period_start,
      current_period_end: insertedInvoice.period_end
    }, { id: 'in_test', amount_paid: 10000, currency: 'usd', status: 'paid' }, 'stripe');

    const insertParams = client.query.mock.calls[2][1];
    expect(insertParams[6]).toBe('USD');
    expect(insertParams[7]).toBe(100);
    expect(insertParams[8]).toBe(0);
    expect(insertParams[9]).toBe(100);
    expect(insertParams[10]).toBe(100);
  });
});

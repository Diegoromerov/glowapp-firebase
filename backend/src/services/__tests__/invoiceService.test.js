const { _mapPaymentEventToInvoice } = require('../invoiceService');

describe('invoice payment event normalization', () => {
  test('maps a paid Stripe invoice using its own external invoice ID and cents', () => {
    expect(_mapPaymentEventToInvoice('stripe', {
      id: 'in_renewal_2',
      amount_paid: 24900000,
      currency: 'cop',
      status: 'paid'
    })).toEqual({
      externalInvoiceId: 'in_renewal_2',
      amount: 249000,
      currency: 'COP',
      status: 'paid',
      provider: 'stripe'
    });
  });

  test('maps an approved Wompi transaction to a paid COP invoice', () => {
    expect(_mapPaymentEventToInvoice('wompi', {
      id: 'tx-renewal-2',
      amount_in_cents: 9900000,
      currency: 'COP',
      status: 'APPROVED'
    })).toEqual({
      externalInvoiceId: 'tx-renewal-2',
      amount: 99000,
      currency: 'COP',
      status: 'paid',
      provider: 'wompi'
    });
  });

  test('keeps a nonfinal or failed provider event open', () => {
    expect(_mapPaymentEventToInvoice('wompi', {
      id: 'tx-pending',
      amount_in_cents: 9900000,
      currency: 'COP',
      status: 'PENDING'
    })).toMatchObject({ externalInvoiceId: 'tx-pending', status: 'open' });
  });

  test('does not invent an external invoice ID from a subscription', () => {
    expect(_mapPaymentEventToInvoice('stripe', null)).toEqual({
      externalInvoiceId: null,
      amount: null,
      currency: null,
      status: 'open',
      provider: 'stripe'
    });
  });
});

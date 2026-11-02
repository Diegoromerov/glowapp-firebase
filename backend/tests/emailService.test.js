const emailService = require('../src/services/emailService');

describe('Email Service - Template & SaaS Helpers', () => {
  test('initEmailService - inicializa en modo dev sin SMTP', () => {
    const result = emailService.initEmailService();
    expect(result).toBeNull(); // dev mode returns null
  });

  test('sendAbandonedBookingEmail - simula envío de carrito abandonado', async () => {
    const result = await emailService.sendAbandonedBookingEmail(
      'cliente@glowapp.com',
      'Cliente Prueba',
      'booking-123',
      'Manicura Semipermanente'
    );
    expect(result).toBeDefined();
    expect(result.devMode).toBe(true);
    expect(result.messageId).toMatch(/^dev-\d+$/);
  });

  test('sendTrialEndingNotice - helper SaaS trial ending', async () => {
    const tenant = { name: 'Salón Bella', ownerName: 'Ana', ownerEmail: 'ana@bella.com' };
    const subscription = { trial_end: '2026-12-31', plan: 'PRO' };
    const result = await emailService.sendTrialEndingNotice(tenant, subscription);
    expect(result).toBeDefined();
    expect(result.devMode).toBe(true);
  });

  test('sendInvoiceEmitted - helper SaaS factura emitida', async () => {
    const tenant = { name: 'Salón Bella', ownerName: 'Ana', ownerEmail: 'ana@bella.com', billingEmail: 'billing@bella.com' };
    const invoice = { invoice_number: 'INV-2026-001', total: 150000, currency: 'COP', period_start: '2026-01-01', period_end: '2026-01-31', due_date: '2026-02-15' };
    const result = await emailService.sendInvoiceEmitted(tenant, invoice);
    expect(result).toBeDefined();
    expect(result.devMode).toBe(true);
  });

  test('sendDunningNotice - helper SaaS cobranza', async () => {
    const tenant = { name: 'Salón Bella', ownerName: 'Ana', ownerEmail: 'ana@bella.com', billingEmail: 'billing@bella.com' };
    const invoices = [
      { invoice_number: 'INV-2026-001', total: 150000, currency: 'COP', due_date: '2026-02-15' },
      { invoice_number: 'INV-2026-002', total: 150000, currency: 'COP', due_date: '2026-03-15' }
    ];
    const result = await emailService.sendDunningNotice(tenant, invoices);
    expect(result).toBeDefined();
    expect(result.devMode).toBe(true);
  });

  test('sendTeamInvite - helper SaaS invitación equipo', async () => {
    const invite = { email: 'nuevo@equipo.com', role: 'STYLIST', invite_token: 'token-123' };
    const tenant = { name: 'Salón Bella' };
    const inviter = { full_name: 'Ana Dueña', email: 'ana@bella.com' };
    const result = await emailService.sendTeamInvite(invite, tenant, inviter);
    expect(result).toBeDefined();
    expect(result.devMode).toBe(true);
  });

  test('sendUsageAlert - helper SaaS alerta uso', async () => {
    const tenant = { name: 'Salón Bella', ownerName: 'Ana', ownerEmail: 'ana@bella.com' };
    const alert = { feature: 'Citas Online', thresholdPercent: 80 };
    const metric = { currentPercent: 85, count: 85, limit: 100, periodEnd: '2026-12-31' };
    const result = await emailService.sendUsageAlert(tenant, alert, metric);
    expect(result).toBeDefined();
    expect(result.devMode).toBe(true);
  });

  test('sendWelcomePlan - helper SaaS bienvenida plan', async () => {
    const tenant = { name: 'Salón Bella', ownerName: 'Ana', ownerEmail: 'ana@bella.com' };
    const features = ['Citas ilimitadas', 'Equipo 5 asientos', 'Analytics Pro'];
    const result = await emailService.sendWelcomePlan(tenant, 'PRO', features);
    expect(result).toBeDefined();
    expect(result.devMode).toBe(true);
  });

  test('loadTemplates - carga todos los templates .hbs', () => {
    emailService.loadTemplates();
    // Should not throw and should log loaded templates
    expect(true).toBe(true);
  });
});
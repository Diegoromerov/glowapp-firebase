jest.mock('../config/db', () => ({
  pool: { query: jest.fn() },
  systemPool: { connect: jest.fn() }
}));

jest.mock('../config/tenantRouting', () => ({
  runAsSystem: jest.fn((_deps, callback) => callback({ query: jest.fn() }))
}));

jest.mock('../utils/piiSanitizer', () => ({ maskEmail: jest.fn(() => 'm***@example.com') }));
jest.mock('../services/subscriptionService', () => ({ cancelSubscription: jest.fn() }));
jest.mock('../services/emailService', () => ({
  sendTrialEndingNotice: jest.fn(),
  sendTrialExpiredNotice: jest.fn(),
  sendDunningNotice: jest.fn(),
  sendSubscriptionCanceled: jest.fn()
}));

const { pool } = require('../config/db');
const { runAsSystem } = require('../config/tenantRouting');
const emailService = require('../services/emailService');
const { runTrialDunningCron } = require('../jobs/trialDunningCron');

describe('trialDunningCron', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    runAsSystem.mockImplementation((_deps, callback) => callback({ query: jest.fn() }));
    pool.query.mockResolvedValue({ rows: [] });
  });

  it('runs platform-wide queries in the system context', async () => {
    const result = await runTrialDunningCron();

    expect(runAsSystem).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('trial_dunning_cron'), expect.any(Array));
  });

  it('emails owners for overdue invoices and audits each invoice to prevent duplicate notices', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM invoices i')) {
        return { rows: [{
          id: 47,
          tenant_id: 9,
          tenant_name: 'QA Salon',
          owner_name: 'QA Owner',
          owner_email: 'owner@example.com',
          total: '100000',
          currency: 'COP',
          due_date: '2026-11-20T00:00:00.000Z'
        }] };
      }
      return { rows: [] };
    });

    const result = await runTrialDunningCron();

    expect(emailService.sendDunningNotice).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'QA Salon', ownerName: 'QA Owner', ownerEmail: 'owner@example.com' }),
      [expect.objectContaining({ id: 47 })]
    );
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("'dunning_notice'"),
      ['9', expect.stringContaining('"invoiceId":47')]
    );
    expect(result.dunningSent).toBe(1);
  });
});

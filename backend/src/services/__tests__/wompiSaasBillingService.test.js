const wompiSaasBilling = require('../wompiSaasBillingService');

describe('Wompi SaaS cancellation', () => {
  const tenantId = 'business-profile-qa';

  it.each([true, false])(
    'stops renewal without removing paid access when atPeriodEnd=%s',
    async (atPeriodEnd) => {
      const subscription = {
        id: 'subscription-qa',
        tenant_id: tenantId,
        plan: 'BASIC',
        status: 'active',
        cancel_at_period_end: false,
      };
      const updatedSubscription = { ...subscription, cancel_at_period_end: true };
      const client = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [subscription] })
          .mockResolvedValueOnce({ rows: [updatedSubscription] }),
      };

      const result = await wompiSaasBilling.cancelSubscription(client, tenantId, atPeriodEnd);

      expect(result).toEqual(updatedSubscription);
      expect(client.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining("status IN ('active','past_due')"),
        [tenantId],
      );
      expect(client.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('SET cancel_at_period_end=TRUE'),
        ['subscription-qa'],
      );
      expect(client.query.mock.calls[1][0]).not.toMatch(/status\s*=\s*'canceled'|plan\s*=\s*'FREEMIUM'/i);
    },
  );

  it('does not update anything when the tenant has no active Wompi subscription', async () => {
    const client = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };

    await expect(wompiSaasBilling.cancelSubscription(client, tenantId, false)).resolves.toBeNull();

    expect(client.query).toHaveBeenCalledTimes(1);
  });
});

const {
  canBypassLoginPassword,
  canProvisionDemoAccount,
  isLocalDemoAuthEnabled,
} = require('../utils/loginSecurityPolicy');

describe('login security policy', () => {
  test('production never enables demo or shared seed-password login', () => {
    const env = { NODE_ENV: 'production', ALLOW_DEMO_AUTH: 'true', SEED_PASSWORD: 'private-seed' };

    expect(isLocalDemoAuthEnabled(env)).toBe(false);
    expect(canProvisionDemoAccount('qa@beautyapp.com', env)).toBe(false);
    expect(canBypassLoginPassword({ email: 'qa@beautyapp.com', password: 'anything', env })).toBe(false);
    expect(canBypassLoginPassword({ email: 'qa@example.com', password: 'private-seed', env })).toBe(false);
    expect(canBypassLoginPassword({ email: 'qa@example.com', password: 'Password123!', env })).toBe(false);
  });

  test('local demo login is opt-in and uses only the configured seed password', () => {
    const env = { NODE_ENV: 'development', ALLOW_DEMO_AUTH: 'true', SEED_PASSWORD: 'local-only-secret' };

    expect(canProvisionDemoAccount('qa@beautyapp.com', env)).toBe(true);
    expect(canBypassLoginPassword({ email: 'qa@beautyapp.com', password: 'anything', env })).toBe(true);
    expect(canBypassLoginPassword({ email: 'qa@example.com', password: 'local-only-secret', env })).toBe(true);
    expect(canBypassLoginPassword({ email: 'qa@example.com', password: 'Password123!', env })).toBe(false);
  });

  test('staging and unconfigured development do not silently enable demo access', () => {
    expect(isLocalDemoAuthEnabled({ NODE_ENV: 'staging', ALLOW_DEMO_AUTH: 'true' })).toBe(false);
    expect(isLocalDemoAuthEnabled({ NODE_ENV: 'development' })).toBe(false);
  });
});

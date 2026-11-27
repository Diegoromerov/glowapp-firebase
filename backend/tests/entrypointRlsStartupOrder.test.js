const fs = require('fs');
const path = require('path');

const entrypoint = fs.readFileSync(
  path.resolve(__dirname, '../entrypoint.sh'),
  'utf8',
).replace(/\r\n?/g, '\n');

describe('entrypoint RLS database startup order', () => {
  test('sets the app_rls_user password through migrations before verifying runtime login', () => {
    const prepare = entrypoint.indexOf('node scripts/prepareRlsDatabase.js');
    const verifyRuntime = entrypoint.indexOf('echo "🔐 Verificando el rol de runtime..."');

    expect(prepare).toBeGreaterThanOrEqual(0);
    expect(verifyRuntime).toBeGreaterThanOrEqual(0);
    expect(prepare).toBeLessThan(verifyRuntime);
  });

  test('keeps schema migrations out of the dedicated cron startup path', () => {
    expect(entrypoint).toMatch(
      /if \[ "\$\{RUN_SAAS_FREE_TRIAL_EXPIRATION_CRON:-false\}" != "true" \]; then[\s\S]*?node scripts\/prepareRlsDatabase\.js[\s\S]*?fi/,
    );
  });
});

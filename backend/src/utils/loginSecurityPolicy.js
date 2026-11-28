const DEMO_EMAIL_DOMAINS = Object.freeze([
  '@beautyapp.com',
  '@bellezaapp.com',
  '@correo.com',
  '@cliente.com',
]);

function isDemoEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  return DEMO_EMAIL_DOMAINS.some((domain) => normalized.endsWith(domain));
}

function isLocalDemoAuthEnabled(env = process.env) {
  const environment = String(env.NODE_ENV || '').toLowerCase();
  return ['development', 'test'].includes(environment) && env.ALLOW_DEMO_AUTH === 'true';
}

function canProvisionDemoAccount(email, env = process.env) {
  return isDemoEmail(email) && isLocalDemoAuthEnabled(env);
}

function canBypassLoginPassword({ email, password, env = process.env }) {
  if (!isLocalDemoAuthEnabled(env)) return false;
  if (isDemoEmail(email)) return true;

  const seedPassword = String(env.SEED_PASSWORD || '').trim();
  return Boolean(seedPassword) && (password === seedPassword || String(password || '').trim() === seedPassword);
}

module.exports = {
  isDemoEmail,
  isLocalDemoAuthEnabled,
  canProvisionDemoAccount,
  canBypassLoginPassword,
};

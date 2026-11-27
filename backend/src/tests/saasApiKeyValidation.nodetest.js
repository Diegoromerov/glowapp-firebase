const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateApiKeyExpiryDays,
  validateApiKeyName,
  validateApiKeyScopes,
} = require('../utils/saasApiKeyValidation');

test('API key names require a trimmed string from 3 to 100 characters', () => {
  assert.deepEqual(validateApiKeyName('  CRM sync  '), { value: 'CRM sync' });
  for (const value of [null, {}, '', '  ab  ', 'x'.repeat(101)]) {
    assert.ok(validateApiKeyName(value).error, `expected invalid name: ${String(value)}`);
  }
});

test('API key scopes must be a non-empty array of supported values', () => {
  assert.deepEqual(validateApiKeyScopes(['read', 'read']), { value: ['read'] });
  for (const value of [null, 'read', [], ['read', 3], ['unknown'], ['write'], ['webhooks'], ['admin']]) {
    assert.ok(validateApiKeyScopes(value).error, `expected invalid scopes: ${String(value)}`);
  }
});

test('API key expiry must be an integer between 1 and 365 days', () => {
  for (const value of [1, 30, 90, 365]) {
    assert.deepEqual(validateApiKeyExpiryDays(value), { value });
  }
  for (const value of [-1, 0, 1.5, '30', 366, null]) {
    assert.ok(validateApiKeyExpiryDays(value).error, `expected invalid expiry: ${String(value)}`);
  }
});

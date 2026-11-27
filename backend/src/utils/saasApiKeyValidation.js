const VALID_SCOPES = Object.freeze(['read', 'write', 'webhooks', 'admin']);
const MAX_EXPIRY_DAYS = 365;

function validateApiKeyName(value) {
  if (typeof value !== 'string' || value.trim().length < 3 || value.trim().length > 100) {
    return { error: 'El nombre debe tener entre 3 y 100 caracteres.' };
  }
  return { value: value.trim() };
}

function validateApiKeyScopes(value) {
  if (!Array.isArray(value) || value.length === 0 || value.some((scope) => typeof scope !== 'string')) {
    return { error: 'Selecciona al menos un scope válido.', validScopes: VALID_SCOPES };
  }
  const invalidScopes = [...new Set(value.filter((scope) => !VALID_SCOPES.includes(scope)))];
  if (invalidScopes.length) {
    return { error: 'Scopes inválidos.', invalidScopes, validScopes: VALID_SCOPES };
  }
  return { value: [...new Set(value)] };
}

function validateApiKeyExpiryDays(value) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_EXPIRY_DAYS) {
    return { error: `La vigencia debe ser un número entero entre 1 y ${MAX_EXPIRY_DAYS} días.` };
  }
  return { value };
}

module.exports = {
  MAX_EXPIRY_DAYS,
  VALID_SCOPES,
  validateApiKeyExpiryDays,
  validateApiKeyName,
  validateApiKeyScopes,
};

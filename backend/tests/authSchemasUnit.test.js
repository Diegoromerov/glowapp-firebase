/**
 * tests/authSchemasUnit.test.js
 * P0 t_fix_backend_01 — comportamiento real de los esquemas Zod de autenticación.
 * Ejecuta el módulo real (backend/src/schemas/auth.schema.js) contra el paquete
 * `zod` instalado, sin base de datos. Complementa la guarda estática
 * (authZodValidation.test.js): aquí se prueba QUÉ rechaza y QUÉ acepta.
 */

const {
  registerSchema,
  loginSchema,
  oauthSchema,
  onboardingSchema,
  biometricsConsentSchema,
  fcmTokenSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  selectRoleSchema,
  switchContextSchema,
} = require('../src/schemas/auth.schema');

const ok = (schema, body) => schema.safeParse(body).success;
const firstError = (schema, body) => {
  const r = schema.safeParse(body);
  return r.success ? null : r.error.errors[0].message;
};

describe('registerSchema', () => {
  test('acepta un registro válido', () => {
    expect(ok(registerSchema, { full_name: 'Ana', email: 'ana@glow.app', password: 'secreta1' })).toBe(true);
  });

  test('rechaza email con formato inválido (el defecto original no lo validaba)', () => {
    expect(ok(registerSchema, { full_name: 'Ana', email: 'no-es-email', password: 'secreta1' })).toBe(false);
    expect(firstError(registerSchema, { full_name: 'Ana', email: 'no-es-email', password: 'x' })).toMatch(/email/i);
  });

  test('rechaza campos obligatorios ausentes o de tipo incorrecto', () => {
    expect(ok(registerSchema, { email: 'ana@glow.app', password: 'x' })).toBe(false);
    expect(ok(registerSchema, { full_name: 'Ana', password: 'x' })).toBe(false);
    expect(ok(registerSchema, { full_name: 'Ana', email: 'ana@glow.app' })).toBe(false);
    expect(ok(registerSchema, { full_name: 123, email: 'ana@glow.app', password: 'x' })).toBe(false);
  });

  test('normaliza el email con .trim()', () => {
    const r = registerSchema.safeParse({ full_name: 'Ana', email: '  ana@glow.app  ', password: 'x' });
    expect(r.success).toBe(true);
    expect(r.data.email).toBe('ana@glow.app');
  });
});

describe('loginSchema', () => {
  test('acepta credenciales bien formadas y rechaza email inválido o contraseña vacía', () => {
    expect(ok(loginSchema, { email: 'ana@glow.app', password: 'secreta1' })).toBe(true);
    expect(ok(loginSchema, { email: 'malo', password: 'secreta1' })).toBe(false);
    expect(ok(loginSchema, { email: 'ana@glow.app', password: '' })).toBe(false);
    expect(ok(loginSchema, { email: 'ana@glow.app' })).toBe(false);
  });
});

describe('oauthSchema', () => {
  test('exige email, nombre, auth_provider y provider_id', () => {
    const base = { email: 'a@b.co', nombre: 'Ana', auth_provider: 'GOOGLE', provider_id: '123' };
    expect(ok(oauthSchema, base)).toBe(true);
    ['email', 'nombre', 'auth_provider', 'provider_id'].forEach((k) => {
      const copia = { ...base };
      delete copia[k];
      expect(ok(oauthSchema, copia)).toBe(false);
    });
  });

  test('normaliza provider_id numérico a texto (no rompe el alta federada)', () => {
    const r = oauthSchema.safeParse({ email: 'a@b.co', nombre: 'Ana', auth_provider: 'GOOGLE', provider_id: 10482 });
    expect(r.success).toBe(true);
    expect(r.data.provider_id).toBe('10482');
  });
});

describe('onboardingSchema', () => {
  test('acepta roles válidos sin importar el caso y los normaliza a mayúsculas', () => {
    const r = onboardingSchema.safeParse({ rol: 'salon', aceptar_habeas_data: true, aceptar_terminos: true });
    expect(r.success).toBe(true);
    expect(r.data.rol).toBe('SALON');
  });

  test('rechaza roles fuera del enum y acuses no booleanos', () => {
    expect(ok(onboardingSchema, { rol: 'ADMIN', aceptar_habeas_data: true, aceptar_terminos: true })).toBe(false);
    expect(ok(onboardingSchema, { rol: 'CLIENTE', aceptar_habeas_data: 'si', aceptar_terminos: true })).toBe(false);
  });
});

describe('biometricsConsentSchema / fcmTokenSchema', () => {
  test('consentimiento exige booleano y versión no vacía', () => {
    expect(ok(biometricsConsentSchema, { consentimiento_otorgado: true, version_politica: 'v1' })).toBe(true);
    expect(ok(biometricsConsentSchema, { version_politica: 'v1' })).toBe(false);
    expect(ok(biometricsConsentSchema, { consentimiento_otorgado: 'true', version_politica: 'v1' })).toBe(false);
  });

  test('fcm_token debe ser texto no vacío', () => {
    expect(ok(fcmTokenSchema, { fcm_token: 'abc' })).toBe(true);
    expect(ok(fcmTokenSchema, { fcm_token: '' })).toBe(false);
    expect(ok(fcmTokenSchema, {})).toBe(false);
  });
});

describe('changePasswordSchema / resetPasswordSchema', () => {
  test('exige contraseña nueva de al menos 6 caracteres', () => {
    expect(ok(changePasswordSchema, { current_password: 'vieja1', new_password: 'nueva12' })).toBe(true);
    expect(ok(changePasswordSchema, { current_password: 'vieja1', new_password: 'corta' })).toBe(false);
    expect(ok(resetPasswordSchema, { email: 'a@b.co', otp: '123456', new_password: 'nueva12' })).toBe(true);
    expect(ok(resetPasswordSchema, { email: 'a@b.co', otp: '123456', new_password: 'corta' })).toBe(false);
  });

  test('resetPasswordSchema acepta OTP numérico y lo normaliza a texto', () => {
    const r = resetPasswordSchema.safeParse({ email: 'a@b.co', otp: 123456, new_password: 'nueva12' });
    expect(r.success).toBe(true);
    expect(r.data.otp).toBe('123456');
  });

  test('forgotPasswordSchema exige un email con formato válido', () => {
    expect(ok(forgotPasswordSchema, { email: 'a@b.co' })).toBe(true);
    expect(ok(forgotPasswordSchema, { email: 'nope' })).toBe(false);
    expect(ok(forgotPasswordSchema, {})).toBe(false);
  });
});

describe('selectRoleSchema / switchContextSchema', () => {
  test('selectRole sólo admite CLIENTE/PRESTADOR/SALON (normaliza el caso)', () => {
    const r = selectRoleSchema.safeParse({ role: 'prestador' });
    expect(r.success).toBe(true);
    expect(r.data.role).toBe('PRESTADOR');
    expect(ok(selectRoleSchema, { role: 'ADMIN' })).toBe(false);
    expect(ok(selectRoleSchema, {})).toBe(false);
  });

  test('switchContext admite id como texto o número no vacío', () => {
    expect(ok(switchContextSchema, { business_profile_id: 'abc-1' })).toBe(true);
    expect(ok(switchContextSchema, { business_profile_id: 7 })).toBe(true);
    expect(ok(switchContextSchema, { business_profile_id: '' })).toBe(false);
    expect(ok(switchContextSchema, {})).toBe(false);
  });
});

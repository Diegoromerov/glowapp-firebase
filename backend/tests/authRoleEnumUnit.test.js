/**
 * tests/authRoleEnumUnit.test.js
 * ---------------------------------------------------------------------------
 * P0 t_fix_backend_05 — "onboarding rol sin enum estricto"
 *
 * Comportamiento REAL del enum Zod del rol (requiere el paquete `zod`; NO
 * requiere base de datos ni `npm install` — ver skill Fase C). Complementa a
 * la guarda estática verificando que un rol no-string ya no haga estallar
 * `.toUpperCase()` (el defecto original) y que el enum sea estricto.
 */

const {
  rolUsuarioSchema,
  onboardingRoleSchema,
  ROL_USUARIO,
  ROLES_USUARIO,
} = require('../src/schemas/role.schema');

describe('P0 t_fix_backend_05 — enum Zod del rol de onboarding', () => {
  it('expone exactamente los tres roles canónicos', () => {
    expect([...ROLES_USUARIO].sort()).toEqual(['CLIENTE', 'PRESTADOR', 'SALON']);
  });

  it('acepta los tres roles canónicos y los devuelve en mayúsculas', () => {
    for (const rol of ['CLIENTE', 'PRESTADOR', 'SALON']) {
      const r = rolUsuarioSchema.safeParse(rol);
      expect(r.success).toBe(true);
      expect(r.data).toBe(rol);
    }
  });

  it('normaliza minúsculas y espacios (compatibilidad con el cliente)', () => {
    const r = rolUsuarioSchema.safeParse('  prestador  ');
    expect(r.success).toBe(true);
    expect(r.data).toBe('PRESTADOR');
  });

  it('rechaza un rol fuera del enum', () => {
    const r = rolUsuarioSchema.safeParse('ADMIN');
    expect(r.success).toBe(false);
  });

  it('rechaza tipos no-string SIN lanzar (número/objeto/array/null/booleano)', () => {
    // El defecto original hacía `rol.toUpperCase()` sobre la entrada sin validar:
    // un no-string lanzaba TypeError → 500 en vez de 400.
    const invalidos = [123, 0, {}, [], ['SALON'], null, true, undefined];
    for (const valor of invalidos) {
      expect(() => rolUsuarioSchema.safeParse(valor)).not.toThrow();
      const r = rolUsuarioSchema.safeParse(valor);
      expect(r.success).toBe(false);
    }
  });

  it('el alias de onboarding usa el mismo enum estricto', () => {
    expect(onboardingRoleSchema).toBe(rolUsuarioSchema);
    expect(ROL_USUARIO.options).toEqual(['CLIENTE', 'PRESTADOR', 'SALON']);
  });
});

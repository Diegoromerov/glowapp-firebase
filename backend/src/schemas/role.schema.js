// backend/src/schemas/role.schema.js
const { z } = require('zod');

/**
 * Enum estricto de los roles de usuario.
 *
 * Hallazgo P0 t_fix_backend_05 (authController.js:306): el onboarding aceptaba
 * el rol con un guard ad-hoc
 *   `['CLIENTE','PRESTADOR','SALON'].includes(rol.toUpperCase())`
 * que NO era un tipo enumerado. Consecuencias:
 *   - un `rol` no-string (número, objeto o array) hacía estallar
 *     `rol.toUpperCase()` → TypeError → 500 en vez de un 400 controlado;
 *   - la aceptación dependía de una coerción de método sobre entrada sin
 *     validar (superficie de escalada de privilegios).
 *
 * La fuente canónica de roles vive aquí y se aplica con `z.enum` (tipo
 * enumerado estricto).
 */
const ROLES_USUARIO = ['CLIENTE', 'PRESTADOR', 'SALON'];

// Tipo enumerado estricto: sólo los tres roles canónicos.
const ROL_USUARIO = z.enum(ROLES_USUARIO);

/**
 * Esquema del campo `rol` del onboarding.
 * Valida que la entrada sea texto y normaliza el caso ('cliente' → 'CLIENTE')
 * ANTES de exigir pertenencia al enum estricto, preservando la compatibilidad
 * con el cliente que envía el rol en minúsculas.
 */
const rolUsuarioSchema = z
  .string({
    required_error: 'rol es obligatorio',
    invalid_type_error: 'rol debe ser texto',
  })
  .trim()
  .min(1, 'rol es obligatorio')
  .transform((v) => v.toUpperCase())
  .pipe(ROL_USUARIO);

// Alias semántico para el endpoint de onboarding.
const onboardingRoleSchema = rolUsuarioSchema;

module.exports = {
  ROLES_USUARIO,
  ROL_USUARIO,
  rolUsuarioSchema,
  onboardingRoleSchema,
};

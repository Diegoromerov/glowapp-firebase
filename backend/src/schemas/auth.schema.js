// backend/src/schemas/auth.schema.js
const { z } = require('zod');

/**
 * Esquemas Zod de la superficie de autenticación (authController).
 * Cumplimiento ADR-001 (Checklist Item 3): validación Zod obligatoria en
 * endpoints mutantes. Reemplaza los truthy-checks ad-hoc que no validaban
 * formato ni tipo (hallazgo P0 t_fix_backend_01, authController.js:13).
 */

const ROL_USUARIO = z.enum(['CLIENTE', 'PRESTADOR', 'SALON']);

// 📝 Registro local
const registerSchema = z.object({
  full_name: z.string({ required_error: 'full_name es obligatorio', invalid_type_error: 'full_name debe ser texto' }).trim().min(1, 'full_name es obligatorio'),
  email: z.string({ required_error: 'email es obligatorio', invalid_type_error: 'email debe ser texto' }).trim().email('email inválido'),
  password: z.string({ required_error: 'password es obligatorio', invalid_type_error: 'password debe ser texto' }).min(1, 'password es obligatorio'),
  phone: z.string().trim().optional().nullable(),
  role: z.string().optional().nullable(),
});

// 🔐 Login local
const loginSchema = z.object({
  email: z.string({ required_error: 'email es obligatorio', invalid_type_error: 'email debe ser texto' }).trim().email('email inválido'),
  password: z.string({ required_error: 'password es obligatorio', invalid_type_error: 'password debe ser texto' }).min(1, 'password es obligatorio'),
});

// 🔗 Login federado (OAuth)
const oauthSchema = z.object({
  email: z.string({ required_error: 'email es obligatorio' }).trim().email('email inválido'),
  nombre: z.string({ required_error: 'nombre es obligatorio' }).trim().min(1, 'nombre es obligatorio'),
  auth_provider: z.string({ required_error: 'auth_provider es obligatorio' }).trim().min(1, 'auth_provider es obligatorio'),
  provider_id: z.union([z.string(), z.number()], { required_error: 'provider_id es obligatorio' }).transform((v) => String(v)).pipe(z.string().min(1, 'provider_id es obligatorio')),
  foto_url: z.string().optional().nullable(),
});

// 📋 Onboarding (Ley 1581 Habeas Data y Términos)
const onboardingSchema = z.object({
  rol: z.string({ required_error: 'rol es obligatorio' }).trim().min(1, 'rol es obligatorio').transform((v) => v.toUpperCase()).pipe(ROL_USUARIO),
  documento_id_url: z.string().optional().nullable(),
  rut_url: z.string().optional().nullable(),
  certificacion_url: z.string().optional().nullable(),
  aceptar_habeas_data: z.boolean({ required_error: 'aceptar_habeas_data es obligatorio' }),
  aceptar_terminos: z.boolean({ required_error: 'aceptar_terminos es obligatorio' }),
});

// 👁️ Consentimiento biométrico e IA
const biometricsConsentSchema = z.object({
  consentimiento_otorgado: z.boolean({ required_error: 'consentimiento_otorgado es obligatorio' }),
  version_politica: z.string({ required_error: 'version_politica es obligatorio' }).trim().min(1, 'version_politica es obligatorio'),
  dispositivo: z.string().optional().nullable(),
});

// 🔔 Token de notificaciones push (FCM)
const fcmTokenSchema = z.object({
  fcm_token: z.string({ required_error: 'fcm_token es requerido' }).trim().min(1, 'fcm_token es requerido'),
  device_os: z.string().optional().nullable(),
});

// 🔐 Cambio de contraseña (usuario autenticado)
const changePasswordSchema = z.object({
  current_password: z.string({ required_error: 'Contraseña actual y nueva contraseña son requeridas.' }).min(1, 'Contraseña actual y nueva contraseña son requeridas.'),
  new_password: z.string({ required_error: 'Contraseña actual y nueva contraseña son requeridas.' }).min(6, 'La nueva contraseña debe tener al menos 6 caracteres.'),
});

// 🔑 Solicitud de recuperación (OTP)
const forgotPasswordSchema = z.object({
  email: z.string({ required_error: 'El correo electrónico es obligatorio.' }).trim().email('El correo electrónico es obligatorio.'),
});

// 🔄 Restablecer contraseña con OTP
const resetPasswordSchema = z.object({
  email: z.string({ required_error: 'Email, OTP y nueva contraseña son requeridos.' }).trim().email('Email, OTP y nueva contraseña son requeridos.'),
  otp: z.union([z.string(), z.number()], { required_error: 'Email, OTP y nueva contraseña son requeridos.' }).transform((v) => String(v).trim()).pipe(z.string().min(1, 'Email, OTP y nueva contraseña son requeridos.')),
  new_password: z.string({ required_error: 'Email, OTP y nueva contraseña son requeridos.' }).min(6, 'La nueva contraseña debe tener al menos 6 caracteres.'),
});

// 🔀 Selección de rol (post-OAuth)
const selectRoleSchema = z.object({
  role: z.string({ required_error: 'Rol inválido o ausente. Debe ser CLIENTE, PRESTADOR o SALON.' }).trim().min(1, 'Rol inválido o ausente. Debe ser CLIENTE, PRESTADOR o SALON.').transform((v) => v.toUpperCase()).pipe(ROL_USUARIO),
});

// 🔄 Cambio de contexto SaaS
const switchContextSchema = z.object({
  business_profile_id: z.union([z.string().trim().min(1), z.number()], { required_error: 'business_profile_id es obligatorio' }).transform((v) => String(v)),
});

module.exports = {
  ROL_USUARIO,
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
};

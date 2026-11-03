/**
 * tests/authZodValidation.test.js
 * ---------------------------------------------------------------------------
 * P0 t_fix_backend_01 — "authController sin validación Zod/Joi"
 * Archivo señalado por el hallazgo: backend/src/controllers/authController.js:13
 *
 * Guarda de regresión ESTÁTICA (no requiere base de datos ni `npm install`):
 * lee el código fuente y verifica que toda entrada por `req.body` de la
 * superficie de autenticación esté validada con Zod (ADR-001, checklist
 * item 3: "Validación Zod obligatoria en endpoints mutantes").
 *
 * Es dual: corre bajo Jest (`describe`/`it`) y también directo con
 * `node tests/authZodValidation.test.js` (usa solo `assert`, fs y path),
 * de modo que el ciclo rojo-verde puede evidenciarse sin dependencias.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const BACKEND = path.resolve(__dirname, '..');
const leer = (rel) => fs.readFileSync(path.join(BACKEND, rel), 'utf8');
const leerSiExiste = (rel) => {
  const p = path.join(BACKEND, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
};
// Al buscar fabricaciones/ausencias hay que mirar el CÓDIGO, no los comentarios.
const soloCodigo = (src) => (src || '')
  .split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join('\n');

// Aísla la declaración `const <nombre>Schema = ...` hasta la siguiente declaración.
const bloqueEsquema = (src, nombre) => {
  const i = src.indexOf(`const ${nombre}Schema`);
  if (i === -1) return '';
  const j = src.indexOf('\nconst ', i + 1);
  return j === -1 ? src.slice(i) : src.slice(i, j);
};

const SCHEMA_REL = 'src/schemas/auth.schema.js';
const CONTROLLER_REL = 'src/controllers/authController.js';

// Endpoints de auth que leen req.body y por tanto exigen validación.
const ENDPOINTS_VALIDADOS = [
  'register',
  'login',
  'oauth',
  'onboarding',
  'acceptBiometricsConsent',
  'saveFcmToken',
  'changePassword',
  'forgotPassword',
  'resetPassword',
  'selectRole',
  'switchContext',
];

const casos = [];
const caso = (name, fn) => casos.push({ name, fn });

// ---------------------------------------------------------------------------
// 1. El módulo de esquemas Zod existe y está bien formado
// ---------------------------------------------------------------------------

caso('existe backend/src/schemas/auth.schema.js (el controlador no puede validar sin esquema)', () => {
  assert.ok(
    leerSiExiste(SCHEMA_REL),
    `No existe ${SCHEMA_REL}: authController.js:13 sigue sin validación Zod declarativa.`
  );
});

caso('el esquema declara zod como dependencia de validación', () => {
  const src = leerSiExiste(SCHEMA_REL);
  assert.ok(src, `Falta ${SCHEMA_REL}`);
  assert.match(soloCodigo(src), /require\(['"]zod['"]\)/, 'auth.schema.js debe requerir el paquete zod');
  assert.match(soloCodigo(src), /\bz\s*\.\s*object\s*\(/, 'auth.schema.js debe construir esquemas z.object(...)');
});

caso('expone un esquema por cada endpoint mutante de autenticación', () => {
  const src = leerSiExiste(SCHEMA_REL);
  assert.ok(src, `Falta ${SCHEMA_REL}`);
  const esperados = [
    'registerSchema',
    'loginSchema',
    'oauthSchema',
    'onboardingSchema',
    'biometricsConsentSchema',
    'fcmTokenSchema',
    'changePasswordSchema',
    'forgotPasswordSchema',
    'resetPasswordSchema',
    'selectRoleSchema',
    'switchContextSchema',
  ];
  const faltantes = esperados.filter((n) => !new RegExp(`\\b${n}\\b`).test(src));
  assert.deepStrictEqual(faltantes, [], `Esquemas Zod faltantes: ${faltantes.join(', ')}`);
});

caso('registerSchema valida formato de email y tipo de contraseña (no solo presencia)', () => {
  const src = leerSiExiste(SCHEMA_REL);
  assert.ok(src, `Falta ${SCHEMA_REL}`);
  // Bloque del registerSchema
  const bloque = bloqueEsquema(src, 'register');
  assert.ok(bloque, 'No se pudo aislar registerSchema');
  assert.match(bloque, /email\s*:\s*[\s\S]*?\.email\(/, 'registerSchema.email debe usar .email()');
  assert.match(bloque, /password\s*:\s*z\.string\(/, 'registerSchema.password debe ser z.string()');
  assert.match(bloque, /full_name\s*:\s*z\.string\(/, 'registerSchema.full_name debe ser z.string()');
});

caso('loginSchema exige email con formato y contraseña no vacía', () => {
  const src = leerSiExiste(SCHEMA_REL);
  assert.ok(src, `Falta ${SCHEMA_REL}`);
  const bloque = bloqueEsquema(src, 'login');
  assert.ok(bloque, 'No se pudo aislar loginSchema');
  assert.match(bloque, /email\s*:\s*[\s\S]*?\.email\(/, 'loginSchema.email debe usar .email()');
  assert.match(bloque, /password\s*:\s*[\s\S]*?\.min\(1/, 'loginSchema.password debe exigir .min(1)');
});

caso('selectRoleSchema restringe el rol a CLIENTE/PRESTADOR/SALON mediante z.enum', () => {
  const src = leerSiExiste(SCHEMA_REL);
  assert.ok(src, `Falta ${SCHEMA_REL}`);
  assert.match(src, /z\.enum\(\s*\[\s*['"]CLIENTE['"]\s*,\s*['"]PRESTADOR['"]\s*,\s*['"]SALON['"]\s*\]\s*\)/,
    'El rol permitido debe declararse con z.enum([...])');
});

// ---------------------------------------------------------------------------
// 2. El controlador usa realmente los esquemas (gates safeParse)
// ---------------------------------------------------------------------------

caso('authController importa el módulo de esquemas Zod', () => {
  const src = leerSiExiste(CONTROLLER_REL);
  assert.ok(src, `Falta ${CONTROLLER_REL}`);
  assert.match(soloCodigo(src), /require\(['"]\.\.\/schemas\/auth\.schema['"]\)/,
    'authController debe requerir ../schemas/auth.schema');
});

caso('authController invoca la validación Zod sobre req.body en cada endpoint mutante', () => {
  const src = soloCodigo(leerSiExiste(CONTROLLER_REL));
  assert.ok(src, `Falta ${CONTROLLER_REL}`);
  // Se aceptan ambos estilos: `XxxSchema.safeParse(req.body)` inline o
  // `validateBody(XxxSchema, req.body, res)` vía helper compartido.
  const inline = (src.match(/\w+Schema\s*\.\s*safeParse\s*\(\s*req\.body\s*\)/g) || []).length;
  const helper = (src.match(/validateBody\s*\(/g) || []).length;
  const gates = inline + helper;
  assert.ok(
    gates >= ENDPOINTS_VALIDADOS.length,
    `Se esperaban >= ${ENDPOINTS_VALIDADOS.length} gates de validación sobre req.body, hay ${gates}`
  );
  assert.match(src, /safeParse\s*\(\s*body\s*\)|safeParse\s*\(\s*req\.body\s*\)/,
    'La validación debe ejecutarse con safeParse sobre el body de la petición');
});

caso('authController responde 400 cuando la validación Zod falla', () => {
  const src = soloCodigo(leerSiExiste(CONTROLLER_REL));
  assert.ok(src, `Falta ${CONTROLLER_REL}`);
  assert.match(src, /VALIDATION_ERROR/, 'La respuesta de rechazo debe identificarse como VALIDATION_ERROR');
  assert.match(src, /status\(400\)[\s\S]{0,160}VALIDATION_ERROR|VALIDATION_ERROR[\s\S]{0,160}status\(400\)/,
    'Un body inválido debe responder HTTP 400');
});

caso('register dejó atrás el chequeo ad-hoc que no validaba formato', () => {
  const src = soloCodigo(leerSiExiste(CONTROLLER_REL));
  assert.ok(src, `Falta ${CONTROLLER_REL}`);
  assert.doesNotMatch(src, /if\s*\(\s*!full_name\s*\|\|\s*!email\s*\|\|\s*!password\s*\)/,
    'El registro no debe depender solo de un truthy-check sin formato de email');
});

// ---------------------------------------------------------------------------
// 3. No regresión: guardas A360 ya existentes sobre authController
// ---------------------------------------------------------------------------

caso('A360 C-06 (regresión): authController sigue sin imprimir la contraseña', () => {
  const src = leerSiExiste(CONTROLLER_REL);
  assert.ok(src, `Falta ${CONTROLLER_REL}`);
  assert.doesNotMatch(src, /"Password:",\s*password/);
});

// ---------------------------------------------------------------------------
// Runner dual
// ---------------------------------------------------------------------------

const bajoJest = typeof describe === 'function' && typeof it === 'function';
if (bajoJest) {
  describe('P0 t_fix_backend_01 — validación Zod en authController (estático)', () => {
    casos.forEach(({ name, fn }) => it(name, fn));
  });
} else {
  let fallos = 0;
  for (const { name, fn } of casos) {
    try {
      fn();
      console.log(`PASS  ${name}`);
    } catch (e) {
      fallos += 1;
      console.log(`FAIL  ${name}`);
      console.log(`      ${e.message}`);
    }
  }
  console.log(`\n${casos.length - fallos}/${casos.length} pruebas estáticas OK`);
  process.exitCode = fallos ? 1 : 0;
}

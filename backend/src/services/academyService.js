// backend/src/services/academyService.js
// Lógica pura de la Academia Glow (sin acceso a base de datos) para poder testearla
// de forma aislada: calificación del examen, límite de intentos, desbloqueo
// secuencial de lecciones, códigos de certificado y guardas de rol/validación.

const crypto = require('crypto');

/** Roles de API que pueden consumir la academia como alumnas (toApiRole de config/jwt). */
const ACADEMY_ROLES = new Set(['provider', 'salon', 'admin']);

/** Texto canónico del consentimiento (espejo del widget Flutter) cuando el cliente no lo envía. */
const CONSENT_TEXT_VERSION = process.env.ACADEMY_CONSENT_VERSION || 'v1-2026-09';
const CONSENT_TEXT = [
  'Autorizo el tratamiento de mis datos personales y de imágenes (datos sensibles, Ley 1581 de 2012)',
  'con la finalidad exclusiva de realizar las prácticas del curso de colorimetría de GlowAcademy.',
  'Autorizo que GlowApp almacene estas evidencias de forma cifrada y las elimine una vez cumplida su finalidad.',
  'Declaro que puedo revocar esta autorización en cualquier momento y que tengo acceso a consultar,',
  'actualizar y solicitar la supresión de mis datos.',
].join(' ');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function intFromEnv(name, fallback, { min = 1, max = 1000 } = {}) {
  const raw = parseInt(process.env[name], 10);
  if (!Number.isFinite(raw) || raw < min || raw > max) return fallback;
  return raw;
}

/** Umbral de aprobación del examen (%). */
function passPct() {
  return intFromEnv('QUIZ_PASS_PCT', 80, { min: 1, max: 100 });
}

/** Intentos máximos por curso. */
function maxAttempts() {
  return intFromEnv('QUIZ_MAX_ATTEMPTS', 3, { min: 1, max: 99 });
}

function isAcademyRole(role) {
  return ACADEMY_ROLES.has(String(role || '').toLowerCase());
}

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

/** Código público del certificado: GLW- + 48 bits aleatorios. */
function generateCertificateCode() {
  return `GLW-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

/** Ruta/URL pública de verificación de un certificado. */
function verificationUrl(code) {
  const base = (process.env.PUBLIC_WEB_URL || process.env.APP_PUBLIC_URL || '').replace(/\/+$/, '');
  const path = `/verify/${encodeURIComponent(String(code || ''))}`;
  return base ? `${base}${path}` : path;
}

/**
 * Califica un examen.
 * @param {Array<{id:string, correct_index:number}>} quizzes
 * @param {Record<string, unknown>} answers  { quizId: índice elegido }
 */
function gradeQuiz(quizzes, answers, threshold = passPct()) {
  const list = Array.isArray(quizzes) ? quizzes : [];
  const total = list.length;
  let score = 0;

  for (const quiz of list) {
    const given = answers ? answers[quiz.id] : undefined;
    if (given === undefined || given === null || given === '') continue;
    if (Number(given) === Number(quiz.correct_index)) score += 1;
  }

  const correctPct = total > 0 ? (score / total) * 100 : 0;
  return {
    score,
    total,
    correctPct: Number(correctPct.toFixed(2)),
    passPct: threshold,
    approved: total > 0 && correctPct >= threshold,
  };
}

/**
 * Desbloqueo secuencial de lecciones dentro de un curso: la primera lección no
 * completada queda abierta y el resto bloqueadas (el contenido no sale del servidor
 * hasta que la anterior esté completada).
 * Muta y devuelve la lista de módulos recibida (ya ordenada por módulo/lección).
 */
function applySequentialUnlock(modules) {
  const list = Array.isArray(modules) ? modules : [];
  const flat = [];
  for (const mod of list) {
    for (const lesson of (mod.lessons || [])) flat.push(lesson);
  }

  let previousCompleted = true; // la primera lección siempre está abierta
  for (const lesson of flat) {
    lesson.locked = !previousCompleted;
    if (lesson.locked) {
      lesson.content_text = null;
      lesson.video_url = null;
    }
    previousCompleted = lesson.lesson_completed === true;
  }
  return list;
}

/** Progreso agregado del curso. */
function progressOf(lessons) {
  const list = Array.isArray(lessons) ? lessons : [];
  const totalLessons = list.length;
  const completedLessons = list.filter((l) => l.lesson_completed === true).length;
  return {
    totalLessons,
    completedLessons,
    percent: totalLessons > 0 ? Number(((completedLessons / totalLessons) * 100).toFixed(0)) : 0,
    allCompleted: totalLessons > 0 && completedLessons === totalLessons,
  };
}

/** Nombre público minimizado (Ley 1581): "Diego Romerov" -> "Diego R." */
function maskName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Profesional Glow';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[1].charAt(0).toUpperCase()}.`;
}

/** Hash del texto de consentimiento aceptado (prueba de qué se aceptó). */
function consentHash(text) {
  return crypto.createHash('sha256').update(String(text || CONSENT_TEXT)).digest('hex');
}

module.exports = {
  ACADEMY_ROLES,
  CONSENT_TEXT,
  CONSENT_TEXT_VERSION,
  applySequentialUnlock,
  consentHash,
  generateCertificateCode,
  gradeQuiz,
  isAcademyRole,
  isUuid,
  maskName,
  maxAttempts,
  passPct,
  progressOf,
  verificationUrl,
};

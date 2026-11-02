const { wrapRouterAsync } = require('../utils/expressAsync');
// backend/src/routes/academyRoutes.js
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { pool } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const academy = require('../services/academyService');

/**
 * Express 4 no captura rechazos de handlers async: sin esto, un error de pool se
 * convierte en unhandled rejection y termina el proceso (Node >= 15).
 */
const ah = (handler) => (req, res, next) => {
  try {
    return Promise.resolve(handler(req, res, next)).catch(next);
  } catch (err) {
    return next(err);
  }
};

/** La academia certifica profesionales: los clientes no la consumen. */
const requireAcademyRole = (req, res, next) => {
  if (!academy.isAcademyRole(req.user && req.user.role)) {
    return res.status(403).json({ error: 'Solo prestadores y salones pueden usar la academia.' });
  }
  return next();
};

// Verificación pública de certificados: sin login, con límite de tasa.
const verifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas verificaciones. Intenta de nuevo en un minuto.' },
});

/** Estructura completa del curso (módulos + lecciones + progreso del alumno). */
async function loadCourseStructure(courseId, providerId) {
  const courseRes = await pool.query(
    'SELECT * FROM academy_courses WHERE id = $1 AND deleted_at IS NULL',
    [courseId]
  );
  if (!courseRes.rows.length) return null;

  const modulesRes = await pool.query(
    `SELECT id AS module_id, title AS module_title, sort_order AS module_order
       FROM academy_modules
      WHERE course_id = $1
      ORDER BY sort_order ASC, id ASC`,
    [courseId]
  );

  const lessonsRes = await pool.query(
    `SELECT l.id AS lesson_id, l.module_id, l.title AS lesson_title, l.video_url, l.content_text,
            l.sort_order AS lesson_order,
            (p.completed IS NOT NULL AND p.completed = true) AS lesson_completed
       FROM academy_lessons l
       JOIN academy_modules m ON l.module_id = m.id
       LEFT JOIN academy_progress p ON p.lesson_id = l.id AND p.provider_id = $2
      WHERE m.course_id = $1
      ORDER BY m.sort_order ASC, l.sort_order ASC, l.id ASC`,
    [courseId, providerId]
  );

  const modules = modulesRes.rows.map((m) => ({
    id: m.module_id,
    title: m.module_title,
    order: m.module_order,
    lessons: lessonsRes.rows.filter((l) => l.module_id === m.module_id),
  }));

  return { course: courseRes.rows[0], modules, lessons: lessonsRes.rows };
}

/** Lección + curso dueño + estado de desbloqueo secuencial. */
async function loadLessonContext(lessonId, providerId) {
  const { rows } = await pool.query(
    `SELECT l.id AS lesson_id, l.module_id, m.course_id, c.deleted_at
       FROM academy_lessons l
       JOIN academy_modules m ON m.id = l.module_id
       JOIN academy_courses c ON c.id = m.course_id
      WHERE l.id = $1`,
    [lessonId]
  );
  if (!rows.length) return null;

  const context = rows[0];
  const ordered = await pool.query(
    `SELECT l.id AS lesson_id,
            (p.completed IS NOT NULL AND p.completed = true) AS lesson_completed
       FROM academy_lessons l
       JOIN academy_modules m ON m.id = l.module_id
       LEFT JOIN academy_progress p ON p.lesson_id = l.id AND p.provider_id = $2
      WHERE m.course_id = $1
      ORDER BY m.sort_order ASC, l.sort_order ASC, l.id ASC`,
    [context.course_id, providerId]
  );

  const list = ordered.rows;
  const index = list.findIndex((l) => l.lesson_id === context.lesson_id);
  const unlocked = index <= 0 ? true : list[index - 1].lesson_completed === true;

  return { ...context, unlocked, position: index + 1, totalLessons: list.length };
}

/** Intentos consumidos por el alumno en un curso. */
async function attemptsUsed(providerId, courseId) {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS used FROM academy_quiz_attempts WHERE provider_id = $1 AND course_id = $2',
    [providerId, courseId]
  );
  return rows[0] ? rows[0].used : 0;
}

/**
 * GET /api/academy/courses
 * Lista los cursos de capacitación con el progreso del prestador.
 */
router.get('/courses', authMiddleware, requireAcademyRole, ah(async (req, res) => {
  const { rows: courses } = await pool.query(`
    SELECT c.*,
      (SELECT COUNT(*) FROM academy_lessons l
       JOIN academy_modules m ON l.module_id = m.id
       WHERE m.course_id = c.id) as total_lessons,
      (SELECT COUNT(*) FROM academy_progress p
       JOIN academy_lessons l ON p.lesson_id = l.id
       JOIN academy_modules m ON l.module_id = m.id
       WHERE m.course_id = c.id AND p.provider_id = $1) as completed_lessons,
      (SELECT COUNT(*) FROM academy_quizzes q WHERE q.course_id = c.id) as total_quiz_questions,
      EXISTS(SELECT 1 FROM academy_certificates cert
             WHERE cert.course_id = c.id AND cert.provider_id = $1 AND cert.revoked = FALSE) as has_certificate,
      (SELECT COUNT(*) FROM academy_quiz_attempts a
       WHERE a.course_id = c.id AND a.provider_id = $1) as attempts_used
    FROM academy_courses c
    WHERE c.deleted_at IS NULL
    ORDER BY c.created_at ASC
  `, [req.user.id]);

  res.json(courses.map((c) => ({
    ...c,
    pass_pct: academy.passPct(),
    attempts_left: Math.max(0, academy.maxAttempts() - Number(c.attempts_used || 0)),
  })));
}));

/**
 * GET /api/academy/courses/:id
 * Detalle del curso. Las lecciones bloqueadas no exponen su contenido.
 */
router.get('/courses/:id', authMiddleware, requireAcademyRole, ah(async (req, res) => {
  const courseId = req.params.id;
  if (!academy.isUuid(courseId)) {
    return res.status(400).json({ error: 'Identificador de curso inválido.' });
  }

  const data = await loadCourseStructure(courseId, req.user.id);
  if (!data) {
    return res.status(404).json({ error: 'Curso no encontrado.' });
  }

  const modules = academy.applySequentialUnlock(data.modules);
  const progress = academy.progressOf(data.lessons);

  const certRes = await pool.query(
    `SELECT code, obtained_at, revoked, revoked_reason
       FROM academy_certificates
      WHERE provider_id = $1 AND course_id = $2`,
    [req.user.id, courseId]
  );
  const certificate = certRes.rows[0] || null;
  const hasCertificate = Boolean(certificate && certificate.revoked !== true);

  const used = await attemptsUsed(req.user.id, courseId);

  res.json({
    course: data.course,
    hasCertificate,
    certificate: certificate
      ? {
        code: certificate.code,
        obtained_at: certificate.obtained_at,
        revoked: certificate.revoked === true,
        verification_url: academy.verificationUrl(certificate.code),
      }
      : null,
    modules,
    progress,
    passPct: academy.passPct(),
    attemptsUsed: used,
    attemptsLeft: Math.max(0, academy.maxAttempts() - used),
    canTakeQuiz: progress.allCompleted && !hasCertificate && used < academy.maxAttempts(),
  });
}));

/**
 * POST /api/academy/lessons/:id/complete
 * Marca una lección como completada (solo si está desbloqueada y el curso existe).
 */
router.post('/lessons/:id/complete', authMiddleware, requireAcademyRole, ah(async (req, res) => {
  const lessonId = req.params.id;
  if (!academy.isUuid(lessonId)) {
    return res.status(400).json({ error: 'Identificador de lección inválido.' });
  }

  const context = await loadLessonContext(lessonId, req.user.id);
  if (!context) {
    return res.status(404).json({ error: 'Lección no encontrada.' });
  }
  if (context.deleted_at) {
    return res.status(409).json({ error: 'El curso de esta lección no está disponible.' });
  }
  if (!context.unlocked) {
    return res.status(409).json({
      error: 'Esta lección está bloqueada. Completa la lección anterior para desbloquearla.',
      reason: 'locked',
    });
  }

  await pool.query(`
    INSERT INTO academy_progress (provider_id, lesson_id, completed, completed_at)
    VALUES ($1, $2, true, NOW())
    ON CONFLICT (provider_id, lesson_id)
    DO UPDATE SET completed = true, completed_at = NOW()
  `, [req.user.id, lessonId]);

  const structure = await loadCourseStructure(context.course_id, req.user.id);
  const progress = academy.progressOf(structure ? structure.lessons : []);

  res.json({
    ok: true,
    mensaje: 'Lección marcada como completada.',
    progress,
    allCompleted: progress.allCompleted,
  });
}));

/**
 * POST /api/academy/consent
 * Registra o revoca el consentimiento Habeas Data Ley 1581 (con prueba de qué se aceptó).
 */
router.post('/consent', authMiddleware, requireAcademyRole, ah(async (req, res) => {
  const { aceptado } = req.body || {};
  if (typeof aceptado !== 'boolean') {
    return res.status(400).json({ error: 'El campo "aceptado" debe ser booleano.' });
  }

  const texto = (typeof req.body.texto === 'string' && req.body.texto.trim().length > 20)
    ? req.body.texto
    : academy.CONSENT_TEXT;
  const version = (typeof req.body.textoVersion === 'string' && req.body.textoVersion.trim())
    ? req.body.textoVersion.trim().slice(0, 20)
    : academy.CONSENT_TEXT_VERSION;
  const hash = academy.consentHash(texto);
  const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim().slice(0, 45) || null;
  const userAgent = (req.headers['user-agent'] || '').toString().slice(0, 255) || null;

  const result = await pool.query(`
    INSERT INTO academy_consentimientos
      (provider_id, aceptado, fecha_aceptacion, fecha_revocacion,
       texto_version, texto_hash, aceptado_ip, aceptado_user_agent)
    VALUES ($1, $2,
            CASE WHEN $2 THEN NOW() ELSE NULL END,
            CASE WHEN $2 THEN NULL ELSE NOW() END,
            $3, $4, $5, $6)
    ON CONFLICT (provider_id)
    DO UPDATE SET aceptado            = EXCLUDED.aceptado,
                  fecha_aceptacion    = CASE WHEN EXCLUDED.aceptado
                                             THEN NOW()
                                             ELSE academy_consentimientos.fecha_aceptacion END,
                  fecha_revocacion    = CASE WHEN EXCLUDED.aceptado
                                             THEN NULL
                                             ELSE NOW() END,
                  texto_version       = EXCLUDED.texto_version,
                  texto_hash          = EXCLUDED.texto_hash,
                  aceptado_ip         = EXCLUDED.aceptado_ip,
                  aceptado_user_agent = EXCLUDED.aceptado_user_agent
    RETURNING id, aceptado, fecha_aceptacion, fecha_revocacion
  `, [req.user.id, aceptado, version, hash, ip, userAgent]);

  const row = result.rows[0];
  res.json({
    ok: true,
    consentId: row.id,
    aceptado: row.aceptado,
    fechaAceptacion: row.fecha_aceptacion,
    fechaRevocacion: row.fecha_revocacion,
  });
}));

/**
 * GET /api/academy/consent/status
 * Estado del consentimiento biométrico. hasConsent solo si está vigente.
 */
router.get('/consent/status', authMiddleware, requireAcademyRole, ah(async (req, res) => {
  const result = await pool.query(
    `SELECT id, aceptado, fecha_aceptacion, fecha_revocacion, texto_version
       FROM academy_consentimientos WHERE provider_id = $1`,
    [req.user.id]
  );

  if (result.rows.length === 0) {
    return res.json({ hasConsent: false, aceptado: false });
  }

  const row = result.rows[0];
  res.json({
    hasConsent: row.aceptado === true,
    consentId: row.id,
    aceptado: row.aceptado === true,
    fechaAceptacion: row.fecha_aceptacion,
    fechaRevocacion: row.fecha_revocacion,
    textoVersion: row.texto_version,
  });
}));

/**
 * POST /api/academy/worksheets/submit
 * Envía respuestas del taller práctico e imágenes de evidencia (requiere consentimiento vigente).
 */
router.post('/worksheets/submit', authMiddleware, requireAcademyRole, ah(async (req, res) => {
  const { lessonId, respuestas, evidenciaFotoUrl, consentId } = req.body || {};

  if (!academy.isUuid(lessonId)) {
    return res.status(400).json({ error: 'Identificador de lección inválido.' });
  }

  const lesson = await loadLessonContext(lessonId, req.user.id);
  if (!lesson) {
    return res.status(404).json({ error: 'Lección no encontrada.' });
  }

  // Validar existencia de consentimiento activo si hay imágenes biométricas
  if (evidenciaFotoUrl) {
    const consentCheck = await pool.query(
      'SELECT 1 FROM academy_consentimientos WHERE id = $1 AND provider_id = $2 AND aceptado = true',
      [consentId, req.user.id]
    );
    if (consentCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Debe aceptar y firmar el consentimiento de Habeas Data antes de subir fotografías.' });
    }
  }

  await pool.query(`
    INSERT INTO academy_worksheet_submissions (provider_id, lesson_id, respuestas_texto, evidencia_foto_url, consentimiento_id, enviado_at)
    VALUES ($1, $2, $3::jsonb, $4, $5, NOW())
    ON CONFLICT (provider_id, lesson_id)
    DO UPDATE SET respuestas_texto = $3::jsonb, evidencia_foto_url = $4, consentimiento_id = $5, enviado_at = NOW()
  `, [req.user.id, lessonId, JSON.stringify(respuestas || {}), evidenciaFotoUrl || null, consentId || null]);

  res.json({ ok: true, mensaje: 'Respuestas del taller enviadas con éxito.' });
}));

/**
 * POST /api/academy/ai-discrepancy/log
 * Guarda discrepancias de diagnóstico entre el motor de IA y el estilista (Módulo 6).
 */
router.post('/ai-discrepancy/log', authMiddleware, requireAcademyRole, ah(async (req, res) => {
  const { leccionId, diagnosticoIA, criterioHumano, comentarios } = req.body || {};

  if (!academy.isUuid(leccionId)) {
    return res.status(400).json({ error: 'Identificador de lección inválido.' });
  }
  if (!diagnosticoIA || !criterioHumano) {
    return res.status(400).json({ error: 'Se requieren el diagnóstico de IA y el criterio humano.' });
  }

  const lesson = await loadLessonContext(leccionId, req.user.id);
  if (!lesson) {
    return res.status(404).json({ error: 'Lección no encontrada.' });
  }

  await pool.query(`
    INSERT INTO academy_ai_discrepancy_log (provider_id, leccion_id, diagnostico_ia, criterio_humano, comentarios, created_at)
    VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, NOW())
  `, [req.user.id, leccionId, JSON.stringify(diagnosticoIA), JSON.stringify(criterioHumano), comentarios || '']);

  res.json({ ok: true, mensaje: 'Discrepancia registrada para reentrenamiento de IA.' });
}));

/**
 * GET /api/academy/courses/:id/quiz
 * Cuestionario del curso. Solo se entrega con el curso completo y con intentos disponibles.
 */
router.get('/courses/:id/quiz', authMiddleware, requireAcademyRole, ah(async (req, res) => {
  const courseId = req.params.id;
  if (!academy.isUuid(courseId)) {
    return res.status(400).json({ error: 'Identificador de curso inválido.' });
  }

  const data = await loadCourseStructure(courseId, req.user.id);
  if (!data) {
    return res.status(404).json({ error: 'Curso no encontrado.' });
  }

  const progress = academy.progressOf(data.lessons);
  if (!progress.allCompleted) {
    return res.status(409).json({
      error: 'Debes completar todas las lecciones del curso antes de presentar el examen.',
      pendingLessons: progress.totalLessons - progress.completedLessons,
    });
  }

  const used = await attemptsUsed(req.user.id, courseId);
  if (used >= academy.maxAttempts()) {
    // Retry-After: sin esto el cliente reintenta de inmediato y consume el
    // rate limit del gateway. 3600 s = lo que tarda un reinicio de intentos.
    return res.set('Retry-After', '3600').status(429).json({
      retry_after_segundos: 3600,
      error: `Alcanzaste el máximo de ${academy.maxAttempts()} intentos para este curso. Contacta a soporte para reiniciarlos.`,
      attemptsLeft: 0,
    });
  }

  const { rows: quizzes } = await pool.query(
    'SELECT id, question, options FROM academy_quizzes WHERE course_id = $1 ORDER BY id ASC',
    [courseId]
  );

  res.json({
    questions: quizzes,
    passPct: academy.passPct(),
    attemptsLeft: Math.max(0, academy.maxAttempts() - used),
  });
}));

/**
 * POST /api/academy/courses/:id/submit-quiz
 * Califica el examen, registra el intento y emite el certificado verificable.
 */
router.post('/courses/:id/submit-quiz', authMiddleware, requireAcademyRole, ah(async (req, res) => {
  const courseId = req.params.id;
  const { answers } = req.body || {};

  if (!academy.isUuid(courseId)) {
    return res.status(400).json({ error: 'Identificador de curso inválido.' });
  }
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return res.status(400).json({ error: 'Formato de respuestas incorrecto.' });
  }

  const data = await loadCourseStructure(courseId, req.user.id);
  if (!data) {
    return res.status(404).json({ error: 'Curso no encontrado.' });
  }

  // 1. Puerta de integridad: no se califica un curso incompleto.
  const progress = academy.progressOf(data.lessons);
  if (!progress.allCompleted) {
    return res.status(409).json({
      error: 'Debes completar todas las lecciones del curso antes de presentar el examen.',
      pendingLessons: progress.totalLessons - progress.completedLessons,
    });
  }

  // 2. Límite de intentos.
  const maxAttempts = academy.maxAttempts();
  const used = await attemptsUsed(req.user.id, courseId);
  if (used >= maxAttempts) {
    return res.set('Retry-After', '3600').status(429).json({
      retry_after_segundos: 3600,
      error: `Alcanzaste el máximo de ${maxAttempts} intentos para este curso.`,
      attemptsLeft: 0,
    });
  }

  const { rows: quizzes } = await pool.query(
    'SELECT id, question, options, correct_index FROM academy_quizzes WHERE course_id = $1 ORDER BY id ASC',
    [courseId]
  );

  if (!quizzes.length) {
    return res.status(404).json({ error: 'No hay examen registrado para este curso.' });
  }

  const result = academy.gradeQuiz(quizzes, answers, academy.passPct());

  await pool.query(`
    INSERT INTO academy_quiz_attempts
      (provider_id, course_id, score, total, correct_pct, pass_pct, passed, answers, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
  `, [
    req.user.id, courseId, result.score, result.total, result.correctPct,
    result.passPct, result.approved, JSON.stringify(answers),
  ]);

  const attemptsLeft = Math.max(0, maxAttempts - (used + 1));

  if (!result.approved) {
    return res.json({
      approved: false,
      score: result.score,
      total: result.total,
      passPct: result.passPct,
      attemptsLeft,
      mensaje: `No has aprobado. Obtuviste ${result.score} de ${result.total} aciertos (${result.correctPct.toFixed(0)}%). El mínimo requerido para aprobar es ${result.passPct}%.${attemptsLeft > 0 ? ` Te quedan ${attemptsLeft} intento(s).` : ' No te quedan intentos.'}`,
    });
  }

  // 3. Emisión idempotente del certificado con código público verificable.
  const existing = await pool.query(
    'SELECT id, code, obtained_at FROM academy_certificates WHERE provider_id = $1 AND course_id = $2',
    [req.user.id, courseId]
  );

  let certificate = existing.rows[0];
  if (!certificate) {
    const code = academy.generateCertificateCode();
    const inserted = await pool.query(`
      INSERT INTO academy_certificates (provider_id, course_id, obtained_at, code, curriculum_version)
      VALUES ($1, $2, NOW(), $3, 'v1')
      ON CONFLICT (provider_id, course_id) DO NOTHING
      RETURNING id, code, obtained_at
    `, [req.user.id, courseId, code]);

    if (inserted.rows.length) {
      certificate = inserted.rows[0];
      // Registro del certificado verificable (QR / URL pública). No es crítico:
      // si la tabla "Academy Pro" no está disponible, el certificado ya quedó emitido.
      try {
        await pool.query(`
          INSERT INTO qr_certificates (user_id, certificate_id, qr_code, verification_url, issued_at)
          VALUES ($1, $2, $3, $4, NOW())
        `, [req.user.id, certificate.id, certificate.code, academy.verificationUrl(certificate.code)]);
      } catch (qrErr) {
        console.warn('[academia] No se pudo registrar el QR del certificado:', qrErr.message);
      }
    } else {
      const again = await pool.query(
        'SELECT id, code, obtained_at FROM academy_certificates WHERE provider_id = $1 AND course_id = $2',
        [req.user.id, courseId]
      );
      certificate = again.rows[0];
    }
  }

  const courseRes = await pool.query('SELECT badge_name FROM academy_courses WHERE id = $1', [courseId]);

  res.json({
    approved: true,
    score: result.score,
    total: result.total,
    passPct: result.passPct,
    attemptsLeft,
    badgeName: (courseRes.rows[0] && courseRes.rows[0].badge_name) || 'Certificado de Aprobación',
    certificateCode: certificate ? certificate.code : null,
    verificationUrl: certificate ? academy.verificationUrl(certificate.code) : null,
    mensaje: `¡Excelente! Aprobaste con ${result.score} de ${result.total} aciertos (${result.correctPct.toFixed(0)}%). Insignia de certificación obtenida.`,
  });
}));

/**
 * GET /api/academy/verify/:code
 * Verificación pública del certificado (sin login, sin datos personales sensibles).
 */
router.get('/verify/:code', verifyLimiter, ah(async (req, res) => {
  const code = String(req.params.code || '').trim();
  if (!/^GLW-[0-9A-F]{8,16}$/i.test(code)) {
    return res.status(400).json({ valid: false, error: 'Código de certificado inválido.' });
  }

  const { rows } = await pool.query(`
    SELECT cert.code, cert.obtained_at, cert.revoked, cert.revoked_reason, cert.revoked_at,
           c.title AS course_title, c.category, c.badge_name, c.deleted_at,
           u.nombre AS holder_name
      FROM academy_certificates cert
      JOIN academy_courses c ON c.id = cert.course_id
      JOIN usuarios u ON u.id = cert.provider_id
     WHERE upper(cert.code) = upper($1)
  `, [code]);

  if (!rows.length) {
    return res.status(404).json({ valid: false, error: 'Certificado no encontrado.' });
  }

  const row = rows[0];
  const valid = row.revoked !== true && row.deleted_at === null;

  res.json({
    valid,
    status: row.revoked ? 'REVOKED' : (valid ? 'VALID' : 'UNAVAILABLE'),
    code: row.code,
    holder: academy.maskName(row.holder_name),
    course: { title: row.course_title, category: row.category, badge: row.badge_name },
    issuedAt: row.obtained_at,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason || null,
    verifiedAt: new Date().toISOString(),
  });
}));

wrapRouterAsync(router);
module.exports = router;

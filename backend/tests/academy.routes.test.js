// backend/tests/academy.routes.test.js
// Pruebas de integración (HTTP) de /api/academy con la base de datos mockeada.
// Cubren los hallazgos de integridad de la auditoría 2026-09-22: desbloqueo
// secuencial, puerta de examen, límite de intentos, certificado verificable,
// consentimiento (alta/revocación) y el envoltorio async de Express 4.

jest.mock('../src/config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.user = {
      id: Number(req.headers['x-user-id'] || 7),
      role: req.headers['x-user-role'] || 'provider',
    };
    next();
  },
}));

const express = require('express');
const request = require('supertest');
const { pool } = require('../src/config/db');
const academyRoutes = require('../src/routes/academyRoutes');

const app = express();
app.use(express.json());
app.use('/api/academy', academyRoutes);
// Manejador de errores: si el envoltorio async no funcionara, la petición colgaría
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

const COURSE_ID = 'c0000000-0000-0000-0000-000000000003';
const LESSON_1 = 'a0000000-0000-0000-0000-000000000001';
const LESSON_2 = 'a0000000-0000-0000-0000-000000000002';
const LESSON_3 = 'a0000000-0000-0000-0000-000000000003';

const courseRow = {
  id: COURSE_ID,
  title: 'Especialista en Colorimetría',
  category: 'colorimetria',
  badge_name: 'Colorista Glow Certificada',
  deleted_at: null,
};

const lessons = [
  { lesson_id: LESSON_1, module_id: 'm1', lesson_title: 'L1', video_url: null, content_text: 'texto 1', lesson_order: 1, lesson_completed: false },
  { lesson_id: LESSON_2, module_id: 'm1', lesson_title: 'L2', video_url: 'https://v/2', content_text: 'texto 2', lesson_order: 2, lesson_completed: false },
  { lesson_id: LESSON_3, module_id: 'm1', lesson_title: 'L3', video_url: null, content_text: 'texto 3', lesson_order: 3, lesson_completed: false },
];

let queryLog = [];

function installDbMock(overrides = {}) {
  queryLog = [];
  pool.query.mockImplementation((sql, params = []) => {
    const q = String(sql);
    queryLog.push({ sql: q, params });

    if (overrides.failOnCourseList && q.includes('FROM academy_courses c')) {
      return Promise.reject(new Error('conexión caída'));
    }
    if (q.includes('SELECT badge_name FROM academy_courses')) {
      return Promise.resolve({ rows: [{ badge_name: courseRow.badge_name }] });
    }
    if (q.includes('SELECT id AS module_id')) {
      return Promise.resolve({ rows: overrides.modules || [{ module_id: 'm1', module_title: 'Módulo 1', module_order: 1 }] });
    }
    if (q.includes('LEFT JOIN academy_progress p ON p.lesson_id = l.id') && !q.includes('FROM academy_courses c')) {
      return Promise.resolve({ rows: overrides.lessons || lessons });
    }
    if (q.includes('JOIN academy_courses c ON c.id = m.course_id')) {
      return Promise.resolve({ rows: overrides.lessonContext || [{ lesson_id: LESSON_1, module_id: 'm1', course_id: COURSE_ID, deleted_at: null }] });
    }
    if (q.includes('COUNT(*)::int AS used')) {
      return Promise.resolve({ rows: [{ used: overrides.attemptsUsed || 0 }] });
    }
    if (q.includes('FROM academy_quizzes') && !q.includes('FROM academy_courses c')) {
      const base = overrides.quizzes || [{ id: 'q1', question: 'P1', options: ['a', 'b'], correct_index: 1 }];
      const rows = q.includes('correct_index') ? base : base.map(({ correct_index, ...rest }) => rest);
      return Promise.resolve({ rows });
    }
    if (q.includes('INSERT INTO academy_progress')) return Promise.resolve({ rows: [] });
    if (q.includes('INSERT INTO academy_quiz_attempts')) return Promise.resolve({ rows: [] });
    if (q.includes('SELECT id, code, obtained_at FROM academy_certificates')) {
      return Promise.resolve({ rows: overrides.existingCert || [] });
    }
    if (q.includes('INSERT INTO academy_certificates')) {
      return Promise.resolve({ rows: [{ id: 42, code: params[2], obtained_at: '2026-09-22T10:00:00Z' }] });
    }
    if (q.includes('FROM academy_certificates cert') && q.includes('JOIN usuarios')) {
      return Promise.resolve({ rows: overrides.verifyRows || [] });
    }
    if (q.includes('FROM academy_certificates') && q.includes('revoked') && q.includes('course_id = $2')) {
      return Promise.resolve({ rows: overrides.certificateRows || [] });
    }
    if (q.includes('INSERT INTO academy_worksheet_submissions')) return Promise.resolve({ rows: [] });
    if (q.includes('INSERT INTO academy_ai_discrepancy_log')) return Promise.resolve({ rows: [] });
    if (q.includes('INSERT INTO qr_certificates')) return Promise.resolve({ rows: [] });
    if (q.includes('FROM academy_certificates cert') && q.includes('JOIN usuarios')) {
      return Promise.resolve({ rows: overrides.verifyRows || [] });
    }
    if (q.includes('INSERT INTO academy_consentimientos')) {
      return Promise.resolve({
        rows: [{
          id: 9,
          aceptado: params[1],
          fecha_aceptacion: params[1] ? '2026-09-22T10:00:00Z' : '2026-09-01T10:00:00Z',
          fecha_revocacion: params[1] ? null : '2026-09-22T10:00:00Z',
        }],
      });
    }
    if (q.includes('FROM academy_consentimientos WHERE id = $1')) {
      return Promise.resolve({ rows: overrides.consentRows || [] });
    }
    if (q.includes('FROM academy_consentimientos')) {
      return Promise.resolve({ rows: overrides.consentStatusRows || [] });
    }
    if (q.includes('FROM academy_courses') && q.includes('WHERE id = $1')) {
      return Promise.resolve({ rows: overrides.course === null ? [] : [overrides.course || courseRow] });
    }
    if (q.includes('FROM academy_courses c')) {
      return Promise.resolve({ rows: overrides.courseList || [courseRow] });
    }
    return Promise.reject(new Error(`SQL inesperado en el test: ${q.slice(0, 80)}`));
  });
}

const asRole = (req, role) => req.set('x-user-role', role);
const called = (fragment) => queryLog.some((entry) => entry.sql.includes(fragment));
const entryFor = (fragment) => queryLog.find((entry) => entry.sql.includes(fragment));

beforeEach(() => installDbMock());

describe('control de acceso y validación de entrada', () => {
  test('un cliente no puede consumir la academia (403)', async () => {
    const res = await asRole(request(app).get('/api/academy/courses'), 'client');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/prestadores/i);
  });

  test('un salon sí puede consumirla', async () => {
    const res = await asRole(request(app).get('/api/academy/courses'), 'salon');
    expect(res.status).toBe(200);
  });

  test('UUID inválido => 400 sin tocar la base de datos', async () => {
    const res = await request(app).get('/api/academy/courses/1');
    expect(res.status).toBe(400);
    expect(queryLog.length).toBe(0);
  });

  test('curso inexistente => 404', async () => {
    installDbMock({ course: null });
    const res = await request(app).get(`/api/academy/courses/${COURSE_ID}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/academy/courses', () => {
  test('expone umbral de aprobación e intentos restantes', async () => {
    installDbMock({ courseList: [{ ...courseRow, attempts_used: 1 }] });
    const res = await request(app).get('/api/academy/courses');
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ pass_pct: 80, attempts_left: 2 });
  });
});

describe('GET /api/academy/courses/:id (desbloqueo secuencial)', () => {
  test('solo la primera lección abierta; las bloqueadas no exponen contenido', async () => {
    const res = await request(app).get(`/api/academy/courses/${COURSE_ID}`);
    expect(res.status).toBe(200);

    const flat = res.body.modules.flatMap((m) => m.lessons);
    expect(flat[0].locked).toBe(false);
    expect(flat[1].locked).toBe(true);
    expect(flat[1].content_text).toBeNull();
    expect(flat[1].video_url).toBeNull();
    expect(res.body.progress).toMatchObject({ totalLessons: 3, completedLessons: 0, allCompleted: false });
    expect(res.body).toMatchObject({ passPct: 80, attemptsLeft: 3, canTakeQuiz: false, hasCertificate: false });
  });

  test('con el curso completo y sin certificado, canTakeQuiz es true', async () => {
    installDbMock({ lessons: lessons.map((l) => ({ ...l, lesson_completed: true })) });
    const res = await request(app).get(`/api/academy/courses/${COURSE_ID}`);
    expect(res.body.progress.allCompleted).toBe(true);
    expect(res.body.canTakeQuiz).toBe(true);
  });

  test('un certificado revocado no cuenta como certificado vigente', async () => {
    installDbMock({
      lessons: lessons.map((l) => ({ ...l, lesson_completed: true })),
      certificateRows: [{ code: 'GLW-AAAAAAAAAAAA', obtained_at: '2026-09-22T10:00:00Z', revoked: true, revoked_reason: 'fraude' }],
    });
    const res = await request(app).get(`/api/academy/courses/${COURSE_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.hasCertificate).toBe(false);
    expect(res.body.certificate).toMatchObject({ revoked: true, code: 'GLW-AAAAAAAAAAAA' });
    // Puede volver a presentar el examen: el certificado revocado no bloquea
    expect(res.body.canTakeQuiz).toBe(true);
  });
});

describe('POST /api/academy/lessons/:id/complete', () => {
  test('rechaza completar una lección bloqueada (409)', async () => {
    installDbMock({
      lessonContext: [{ lesson_id: LESSON_3, module_id: 'm1', course_id: COURSE_ID, deleted_at: null }],
    });
    const res = await request(app).post(`/api/academy/lessons/${LESSON_3}/complete`).send({});
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('locked');
    expect(called('INSERT INTO academy_progress')).toBe(false);
  });

  test('completa la lección desbloqueada y devuelve el progreso', async () => {
    installDbMock({
      lessons: [{ ...lessons[0], lesson_completed: true }, lessons[1], lessons[2]],
    });
    const res = await request(app).post(`/api/academy/lessons/${LESSON_1}/complete`).send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.progress).toMatchObject({ completedLessons: 1, totalLessons: 3 });
    expect(called('INSERT INTO academy_progress')).toBe(true);
  });

  test('lección inexistente => 404', async () => {
    installDbMock({ lessonContext: [] });
    const res = await request(app).post(`/api/academy/lessons/${LESSON_1}/complete`).send({});
    expect(res.status).toBe(404);
  });

  test('curso archivado => 409', async () => {
    installDbMock({
      lessonContext: [{ lesson_id: LESSON_1, module_id: 'm1', course_id: COURSE_ID, deleted_at: '2026-09-22' }],
    });
    const res = await request(app).post(`/api/academy/lessons/${LESSON_1}/complete`).send({});
    expect(res.status).toBe(409);
  });

  test('la ruta completa el progreso de forma idempotente (ON CONFLICT)', async () => {
    await request(app).post(`/api/academy/lessons/${LESSON_1}/complete`).send({});
    const insert = entryFor('INSERT INTO academy_progress');
    expect(insert.sql).toContain('ON CONFLICT (provider_id, lesson_id)');
    expect(insert.params).toEqual([7, LESSON_1]);
  });
});

describe('POST /api/academy/consent', () => {
  test('exige booleano en "aceptado"', async () => {
    const res = await request(app).post('/api/academy/consent').send({ aceptado: 'true' });
    expect(res.status).toBe(400);
    expect(called('INSERT INTO academy_consentimientos')).toBe(false);
  });

  test('registra la revocación con fecha_revocacion (antes se guardaba como aceptación)', async () => {
    const res = await request(app).post('/api/academy/consent').send({ aceptado: false });
    expect(res.status).toBe(200);

    const insert = entryFor('INSERT INTO academy_consentimientos');
    expect(insert.sql).toContain('fecha_revocacion');
    expect(insert.sql).toContain('CASE WHEN EXCLUDED.aceptado');
    expect(insert.params[1]).toBe(false);
    expect(res.body.aceptado).toBe(false);
  });

  test('guarda la prueba del consentimiento (versión, hash, IP y user-agent)', async () => {
    await request(app).post('/api/academy/consent').send({ aceptado: true, textoVersion: 'v2-2026' });
    const insert = entryFor('INSERT INTO academy_consentimientos');
    const [providerId, aceptado, version, hash, ip] = insert.params;
    expect(providerId).toBe(7);
    expect(aceptado).toBe(true);
    expect(version).toBe('v2-2026');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof ip === 'string' || ip === null).toBe(true);
  });
});

describe('GET /api/academy/consent/status', () => {
  test('sin registro => hasConsent false', async () => {
    const res = await request(app).get('/api/academy/consent/status');
    expect(res.body).toMatchObject({ hasConsent: false, aceptado: false });
  });

  test('con consentimiento revocado => hasConsent false', async () => {
    installDbMock({ consentStatusRows: [{ id: 9, aceptado: false, texto_version: 'v1' }] });
    const res = await request(app).get('/api/academy/consent/status');
    expect(res.body).toMatchObject({ hasConsent: false, aceptado: false });
  });
});

describe('POST /api/academy/worksheets/submit', () => {
  test('exige consentimiento vigente para subir fotografías', async () => {
    const res = await request(app)
      .post('/api/academy/worksheets/submit')
      .send({ lessonId: LESSON_1, evidenciaFotoUrl: 'https://cdn/foto.jpg', consentId: 9 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/consentimiento/i);
    expect(called('INSERT INTO academy_worksheet_submissions')).toBe(false);
  });

  test('acepta el taller cuando el consentimiento está vigente', async () => {
    installDbMock({ consentRows: [{ id: 9 }] });
    const res = await request(app)
      .post('/api/academy/worksheets/submit')
      .send({ lessonId: LESSON_1, respuestas: { a: 1 } });
    expect(res.status).toBe(200);
    expect(called('INSERT INTO academy_worksheet_submissions')).toBe(true);
  });

  test('lección inválida => 400', async () => {
    const res = await request(app)
      .post('/api/academy/worksheets/submit')
      .send({ lessonId: 'no-uuid' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/academy/courses/:id/quiz', () => {
  test('no entrega el examen con el curso incompleto (409)', async () => {
    installDbMock({ lessons: [{ ...lessons[0], lesson_completed: true }, lessons[1], lessons[2]] });
    const res = await request(app).get(`/api/academy/courses/${COURSE_ID}/quiz`);
    expect(res.status).toBe(409);
    expect(res.body.pendingLessons).toBe(2);
  });

  test('con el curso completo entrega preguntas sin la respuesta correcta', async () => {
    installDbMock({ lessons: lessons.map((l) => ({ ...l, lesson_completed: true })) });
    const res = await request(app).get(`/api/academy/courses/${COURSE_ID}/quiz`);
    expect(res.status).toBe(200);
    expect(res.body.questions[0]).not.toHaveProperty('correct_index');
    expect(res.body).toMatchObject({ passPct: 80, attemptsLeft: 3 });
  });

  test('sin intentos disponibles => 429', async () => {
    installDbMock({
      lessons: lessons.map((l) => ({ ...l, lesson_completed: true })),
      attemptsUsed: 3,
    });
    const res = await request(app).get(`/api/academy/courses/${COURSE_ID}/quiz`);
    expect(res.status).toBe(429);
  });
});

describe('POST /api/academy/courses/:id/submit-quiz', () => {
  const completeLessons = () => installDbMock({
    lessons: lessons.map((l) => ({ ...l, lesson_completed: true })),
  });

  test('rechaza calificar un curso incompleto', async () => {
    const res = await request(app)
      .post(`/api/academy/courses/${COURSE_ID}/submit-quiz`)
      .send({ answers: { q1: 1 } });
    expect(res.status).toBe(409);
    expect(called('INSERT INTO academy_quiz_attempts')).toBe(false);
  });

  test('rechaza las respuestas con formato inválido', async () => {
    const res = await request(app)
      .post(`/api/academy/courses/${COURSE_ID}/submit-quiz`)
      .send({ answers: [1, 2] });
    expect(res.status).toBe(400);
  });

  test('agota los intentos => 429', async () => {
    completeLessons();
    installDbMock({
      lessons: lessons.map((l) => ({ ...l, lesson_completed: true })),
      attemptsUsed: 3,
    });
    const res = await request(app)
      .post(`/api/academy/courses/${COURSE_ID}/submit-quiz`)
      .send({ answers: { q1: 1 } });
    expect(res.status).toBe(429);
    expect(called('INSERT INTO academy_quiz_attempts')).toBe(false);
  });

  test('al fallar registra el intento y no emite certificado', async () => {
    completeLessons();
    const res = await request(app)
      .post(`/api/academy/courses/${COURSE_ID}/submit-quiz`)
      .send({ answers: { q1: 0 } });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ approved: false, score: 0, total: 1, passPct: 80, attemptsLeft: 2 });
    expect(res.body.mensaje).toContain('80%');
    expect(called('INSERT INTO academy_quiz_attempts')).toBe(true);
    expect(called('INSERT INTO academy_certificates')).toBe(false);
  });

  test('al aprobar emite certificado con código verificable y registra el QR', async () => {
    completeLessons();
    const res = await request(app)
      .post(`/api/academy/courses/${COURSE_ID}/submit-quiz`)
      .send({ answers: { q1: 1 } });

    expect(res.status).toBe(200);
    expect(res.body.approved).toBe(true);
    expect(res.body.certificateCode).toMatch(/^GLW-[0-9A-F]{12}$/);
    expect(res.body.verificationUrl).toContain(`/verify/${res.body.certificateCode}`);
    expect(res.body.badgeName).toBe('Colorista Glow Certificada');

    const certInsert = entryFor('INSERT INTO academy_certificates');
    expect(certInsert.params[2]).toBe(res.body.certificateCode);
    expect(certInsert.sql).toContain('ON CONFLICT (provider_id, course_id) DO NOTHING');

    const attemptInsert = entryFor('INSERT INTO academy_quiz_attempts');
    expect(attemptInsert.params[6]).toBe(true); // passed
    expect(called('INSERT INTO qr_certificates')).toBe(true);
  });

  test('si el certificado ya existía no se duplica', async () => {
    completeLessons();
    installDbMock({
      lessons: lessons.map((l) => ({ ...l, lesson_completed: true })),
      existingCert: [{ id: 42, code: 'GLW-AAAAAAAAAAAA', obtained_at: '2026-01-01T00:00:00Z' }],
    });
    const res = await request(app)
      .post(`/api/academy/courses/${COURSE_ID}/submit-quiz`)
      .send({ answers: { q1: 1 } });
    expect(res.body.certificateCode).toBe('GLW-AAAAAAAAAAAA');
    expect(called('INSERT INTO academy_certificates')).toBe(false);
  });
});

describe('GET /api/academy/verify/:code', () => {
  test('código con formato inválido => 400', async () => {
    const res = await request(app).get('/api/academy/verify/lo-que-sea');
    expect(res.status).toBe(400);
    expect(res.body.valid).toBe(false);
  });

  test('certificado inexistente => 404', async () => {
    const res = await request(app).get('/api/academy/verify/GLW-AAAAAAAAAAAA');
    expect(res.status).toBe(404);
  });

  test('certificado válido => datos públicos minimizados', async () => {
    installDbMock({
      verifyRows: [{
        code: 'GLW-AAAAAAAAAAAA',
        obtained_at: '2026-09-22T10:00:00Z',
        revoked: false,
        revoked_reason: null,
        revoked_at: null,
        course_title: 'Especialista en Colorimetría',
        category: 'colorimetria',
        badge_name: 'Colorista Glow',
        deleted_at: null,
        holder_name: 'Diego Romerov',
      }],
    });
    const res = await request(app).get('/api/academy/verify/glw-aaaaaaaaaaaa');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ valid: true, status: 'VALID', holder: 'Diego R.', code: 'GLW-AAAAAAAAAAAA' });
    expect(res.body.course.title).toBe('Especialista en Colorimetría');
    expect(JSON.stringify(res.body)).not.toMatch(/@|email|provider_id|user_id/);
  });

  test('certificado revocado => no válido y con motivo', async () => {
    installDbMock({
      verifyRows: [{
        code: 'GLW-AAAAAAAAAAAA',
        obtained_at: '2026-09-22T10:00:00Z',
        revoked: true,
        revoked_reason: 'Fraude en el examen',
        revoked_at: '2026-09-23T10:00:00Z',
        course_title: 'Especialista en Colorimetría',
        category: 'colorimetria',
        badge_name: 'Colorista Glow',
        deleted_at: null,
        holder_name: 'Diego Romerov',
      }],
    });
    const res = await request(app).get('/api/academy/verify/GLW-AAAAAAAAAAAA');
    expect(res.body).toMatchObject({ valid: false, status: 'REVOKED', revokedReason: 'Fraude en el examen' });
  });
});

describe('robustez de Express 4 con handlers async', () => {
  test('un error de base de datos devuelve 500 y no tumba el proceso', async () => {
    installDbMock({ failOnCourseList: true });
    const res = await request(app).get('/api/academy/courses');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('conexión caída');
  });
});

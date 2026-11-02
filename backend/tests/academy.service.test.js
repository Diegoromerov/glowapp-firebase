// backend/tests/academy.service.test.js
// Pruebas unitarias de la lógica pura de la Academia Glow (auditoría 2026-09-22).
const academy = require('../src/services/academyService');

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('academyService.gradeQuiz', () => {
  const quizzes = [
    { id: 'q1', correct_index: 1 },
    { id: 'q2', correct_index: 0 },
  ];

  test('aprueba con el 100% y con el umbral exacto', () => {
    const perfect = academy.gradeQuiz(quizzes, { q1: 1, q2: 0 }, 80);
    expect(perfect).toMatchObject({ score: 2, total: 2, correctPct: 100, approved: true });

    const threshold = academy.gradeQuiz(quizzes, { q1: 1, q2: 3 }, 50);
    expect(threshold.correctPct).toBe(50);
    expect(threshold.approved).toBe(true);
  });

  test('rechaza por debajo del umbral', () => {
    const result = academy.gradeQuiz(quizzes, { q1: 1, q2: 1 }, 80);
    expect(result).toMatchObject({ score: 1, correctPct: 50, approved: false, passPct: 80 });
  });

  test('acepta respuestas numéricas en texto y descarta las ausentes o vacías', () => {
    const asText = academy.gradeQuiz(quizzes, { q1: '1', q2: '0' }, 80);
    expect(asText.score).toBe(2);

    const missing = academy.gradeQuiz(quizzes, { q1: 1 }, 80);
    expect(missing).toMatchObject({ score: 1, total: 2 });

    const empty = academy.gradeQuiz(quizzes, { q1: 1, q2: '' }, 80);
    expect(empty.score).toBe(1);
  });

  test('un examen sin preguntas nunca se aprueba (antes: división por cero => NaN >= 80 era false, pero el flujo seguía)', () => {
    const result = academy.gradeQuiz([], {}, 80);
    expect(result).toMatchObject({ score: 0, total: 0, correctPct: 0, approved: false });
  });
});

describe('academyService configuración por entorno', () => {
  test('valores por defecto: 80% y 3 intentos', () => {
    delete process.env.QUIZ_PASS_PCT;
    delete process.env.QUIZ_MAX_ATTEMPTS;
    expect(academy.passPct()).toBe(80);
    expect(academy.maxAttempts()).toBe(3);
  });

  test('valores fuera de rango caen al default (no se acepta 0% ni 1000 intentos)', () => {
    process.env.QUIZ_PASS_PCT = '0';
    process.env.QUIZ_MAX_ATTEMPTS = '1000';
    expect(academy.passPct()).toBe(80);
    expect(academy.maxAttempts()).toBe(3);

    process.env.QUIZ_PASS_PCT = 'no-numero';
    expect(academy.passPct()).toBe(80);
  });

  test('respeta valores válidos del entorno', () => {
    process.env.QUIZ_PASS_PCT = '90';
    process.env.QUIZ_MAX_ATTEMPTS = '5';
    expect(academy.passPct()).toBe(90);
    expect(academy.maxAttempts()).toBe(5);
  });
});

describe('academyService.applySequentialUnlock', () => {
  const buildModules = () => ([
    {
      id: 'm1',
      lessons: [
        { lesson_id: 'l1', lesson_completed: false, content_text: 'A', video_url: 'v1' },
        { lesson_id: 'l2', lesson_completed: false, content_text: 'B', video_url: 'v2' },
      ],
    },
    {
      id: 'm2',
      lessons: [
        { lesson_id: 'l3', lesson_completed: false, content_text: 'C', video_url: 'v3' },
      ],
    },
  ]);

  test('solo la primera lección queda abierta y las bloqueadas no exponen contenido', () => {
    const modules = academy.applySequentialUnlock(buildModules());
    const flat = modules.flatMap((m) => m.lessons);

    expect(flat[0].locked).toBe(false);
    expect(flat[1].locked).toBe(true);
    expect(flat[2].locked).toBe(true);
    expect(flat[1]).toMatchObject({ content_text: null, video_url: null });
    expect(flat[2]).toMatchObject({ content_text: null, video_url: null });
  });

  test('avanza el desbloqueo a medida que se completan lecciones', () => {
    const modules = buildModules();
    modules[0].lessons[0].lesson_completed = true;
    academy.applySequentialUnlock(modules);
    expect(modules[0].lessons[1].locked).toBe(false);
    expect(modules[1].lessons[0].locked).toBe(true);

    modules[0].lessons[1].lesson_completed = true;
    academy.applySequentialUnlock(modules);
    expect(modules[1].lessons[0].locked).toBe(false);
  });
});

describe('academyService.progressOf', () => {
  test('calcula totales, porcentaje y si está completo', () => {
    expect(academy.progressOf([
      { lesson_completed: true },
      { lesson_completed: true },
      { lesson_completed: false },
      { lesson_completed: false },
    ])).toEqual({ totalLessons: 4, completedLessons: 2, percent: 50, allCompleted: false });

    expect(academy.progressOf([{ lesson_completed: true }]).allCompleted).toBe(true);
    expect(academy.progressOf([]).allCompleted).toBe(false);
  });
});

describe('academyService validaciones y utilidades', () => {
  test('isUuid acepta UUID v4 vengan en el case que vengan y rechaza basura', () => {
    expect(academy.isUuid('a0000000-0000-0000-0000-000000000001')).toBe(true);
    expect(academy.isUuid('A0000000-0000-0000-0000-000000000001')).toBe(true);
    expect(academy.isUuid('  a0000000-0000-0000-0000-000000000001  ')).toBe(true);
    expect(academy.isUuid('1')).toBe(false);
    expect(academy.isUuid('c0000000-0000-0000-0000-00000000000')).toBe(false);
    expect(academy.isUuid(undefined)).toBe(false);
  });

  test('isAcademyRole permite prestadores/salones/admin y bloquea clientes', () => {
    expect(academy.isAcademyRole('provider')).toBe(true);
    expect(academy.isAcademyRole('PROVIDER')).toBe(true);
    expect(academy.isAcademyRole('salon')).toBe(true);
    expect(academy.isAcademyRole('admin')).toBe(true);
    expect(academy.isAcademyRole('client')).toBe(false);
    expect(academy.isAcademyRole(undefined)).toBe(false);
  });

  test('generateCertificateCode produce códigos únicos con formato GLW-', () => {
    const codes = new Set();
    for (let i = 0; i < 200; i += 1) {
      const code = academy.generateCertificateCode();
      expect(code).toMatch(/^GLW-[0-9A-F]{12}$/);
      codes.add(code);
    }
    expect(codes.size).toBe(200);
  });

  test('verificationUrl usa la base pública cuando está configurada', () => {
    delete process.env.PUBLIC_WEB_URL;
    delete process.env.APP_PUBLIC_URL;
    expect(academy.verificationUrl('GLW-ABC123')).toBe('/verify/GLW-ABC123');

    process.env.PUBLIC_WEB_URL = 'https://glowapp.co/';
    expect(academy.verificationUrl('GLW-ABC123')).toBe('https://glowapp.co/verify/GLW-ABC123');
  });

  test('maskName minimiza el dato personal y nunca queda vacío', () => {
    expect(academy.maskName('Diego Romerov')).toBe('Diego R.');
    expect(academy.maskName('Ana')).toBe('Ana');
    expect(academy.maskName('')).toBe('Profesional Glow');
    expect(academy.maskName(null)).toBe('Profesional Glow');
  });

  test('consentHash es estable y sha256', () => {
    const a = academy.consentHash('texto de prueba');
    const b = academy.consentHash('texto de prueba');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(academy.consentHash('otro texto')).not.toBe(a);
  });
});

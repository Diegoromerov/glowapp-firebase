// backend/src/routes/academyAdminRoutes.js
// Admin routes para gestión de Academia Glow
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const adminMiddleware = require('../middleware/admin');
const academy = require('../services/academyService');
const { wrapRouterAsync } = require('../utils/expressAsync');

// Aplicar middlewares a todas las rutas
router.use(authMiddleware, adminMiddleware);

// ============================================================
// CURSOS
// ============================================================

// GET /api/admin/academy/courses - Listar todos los cursos con stats
router.get('/courses', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        c.*,
        COALESCE(m.count, 0) as modules_count,
        COALESCE(l.count, 0) as lessons_count,
        COALESCE(q.count, 0) as quizzes_count,
        COALESCE(cert.count, 0) as certificates_issued,
        COALESCE(prog.count, 0) as enrolled_providers
      FROM academy_courses c
      LEFT JOIN (
        SELECT course_id, COUNT(*) as count FROM academy_modules GROUP BY course_id
      ) m ON m.course_id = c.id
      LEFT JOIN (
        SELECT m.course_id, COUNT(*) as count 
        FROM academy_lessons l 
        JOIN academy_modules m ON l.module_id = m.id 
        GROUP BY m.course_id
      ) l ON l.course_id = c.id
      LEFT JOIN (
        SELECT course_id, COUNT(*) as count FROM academy_quizzes GROUP BY course_id
      ) q ON q.course_id = c.id
      LEFT JOIN (
        SELECT course_id, COUNT(*) as count FROM academy_certificates
        WHERE revoked = FALSE GROUP BY course_id
      ) cert ON cert.course_id = c.id
      LEFT JOIN (
        SELECT m.course_id, COUNT(DISTINCT p.provider_id) as count
        FROM academy_progress p
        JOIN academy_lessons l ON p.lesson_id = l.id
        JOIN academy_modules m ON l.module_id = m.id
        GROUP BY m.course_id
      ) prog ON prog.course_id = c.id
      WHERE c.deleted_at IS NULL
      ORDER BY c.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error al listar cursos admin:', err);
    res.status(500).json({ error: 'Error al obtener cursos.' });
  }
});

// POST /api/admin/academy/courses - Crear nuevo curso
router.post('/courses', async (req, res) => {
  const { title, description, category, badge_name } = req.body || {};

  // Validar ANTES de abrir la transacción: un `return` con la conexión tomada
  // dejaba la conexión en `idle in transaction` (pg-pool no hace ROLLBACK solo).
  if (!title || !description || !category || !badge_name) {
    return res.status(400).json({ error: 'Faltan campos obligatorios: title, description, category, badge_name' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(`
      INSERT INTO academy_courses (title, description, category, badge_name)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [title, description, category, badge_name]);

    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al crear curso:', err);
    res.status(500).json({ error: 'Error al crear curso.' });
  } finally {
    client.release();
  }
});

// GET /api/admin/academy/courses/:id - Obtener curso completo con módulos, lecciones y quizzes
router.get('/courses/:id', async (req, res) => {
  try {
    const courseId = req.params.id;
    
    const courseRes = await pool.query('SELECT * FROM academy_courses WHERE id = $1', [courseId]);
    if (!courseRes.rows.length) {
      return res.status(404).json({ error: 'Curso no encontrado.' });
    }
    
    const modulesRes = await pool.query(`
      SELECT * FROM academy_modules WHERE course_id = $1 ORDER BY sort_order ASC
    `, [courseId]);
    
    const lessonsRes = await pool.query(`
      SELECT l.*, m.title as module_title, m.sort_order as module_order
      FROM academy_lessons l
      JOIN academy_modules m ON l.module_id = m.id
      WHERE m.course_id = $1
      ORDER BY m.sort_order ASC, l.sort_order ASC
    `, [courseId]);
    
    const quizzesRes = await pool.query(`
      SELECT * FROM academy_quizzes WHERE course_id = $1
    `, [courseId]);

    // Métricas reales del curso (antes la UI mostraba "Certificados: 0" hardcodeado)
    const statsRes = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM academy_certificates WHERE course_id = $1 AND revoked = FALSE) as certificates_issued,
        (SELECT COUNT(*)::int FROM academy_certificates WHERE course_id = $1 AND revoked = TRUE) as certificates_revoked,
        (SELECT COUNT(*)::int FROM academy_quiz_attempts WHERE course_id = $1) as quiz_attempts,
        (SELECT COUNT(DISTINCT provider_id)::int FROM academy_quiz_attempts WHERE course_id = $1) as providers_attempted,
        (SELECT COUNT(DISTINCT p.provider_id)::int
           FROM academy_progress p
           JOIN academy_lessons l ON p.lesson_id = l.id
           JOIN academy_modules m ON l.module_id = m.id
          WHERE m.course_id = $1) as providers_enrolled
    `, [courseId]);

    res.json({
      course: courseRes.rows[0],
      modules: modulesRes.rows,
      lessons: lessonsRes.rows,
      quizzes: quizzesRes.rows,
      stats: statsRes.rows[0]
    });
  } catch (err) {
    console.error('Error al obtener curso admin:', err);
    res.status(500).json({ error: 'Error al obtener curso.' });
  }
});

// PUT /api/admin/academy/courses/:id - Actualizar curso
router.put('/courses/:id', async (req, res) => {
  try {
    const courseId = req.params.id;
    const { title, description, category, badge_name } = req.body;
    
    const { rows } = await pool.query(`
      UPDATE academy_courses 
      SET title = COALESCE($1, title),
          description = COALESCE($2, description),
          category = COALESCE($3, category),
          badge_name = COALESCE($4, badge_name)
      WHERE id = $5
      RETURNING *
    `, [title, description, category, badge_name, courseId]);
    
    if (!rows.length) {
      return res.status(404).json({ error: 'Curso no encontrado.' });
    }
    
    res.json(rows[0]);
  } catch (err) {
    console.error('Error al actualizar curso:', err);
    res.status(500).json({ error: 'Error al actualizar curso.' });
  }
});

// DELETE /api/admin/academy/courses/:id - Archivar curso (soft delete)
// Antes borraba en cascada: perdía progreso y credenciales ya emitidas.
router.delete('/courses/:id', async (req, res) => {
  try {
    const courseId = req.params.id;
    const { rowCount } = await pool.query(
      'UPDATE academy_courses SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
      [courseId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Curso no encontrado o ya archivado.' });
    }

    res.json({
      success: true,
      message: 'Curso archivado. Los certificados ya emitidos siguen siendo verificables.',
      softDelete: true
    });
  } catch (err) {
    console.error('Error al archivar curso:', err);
    res.status(500).json({ error: 'Error al archivar curso.' });
  }
});

// POST /api/admin/academy/courses/:id/restore - Reactivar un curso archivado
router.post('/courses/:id/restore', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'UPDATE academy_courses SET deleted_at = NULL WHERE id = $1 RETURNING *',
      [req.params.id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Curso no encontrado.' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('Error al restaurar curso:', err);
    res.status(500).json({ error: 'Error al restaurar curso.' });
  }
});

// ============================================================
// MÓDULOS
// ============================================================

// POST /api/admin/academy/courses/:courseId/modules - Crear módulo
router.post('/courses/:courseId/modules', async (req, res) => {
  try {
    const { courseId } = req.params;
    const { title, sort_order } = req.body;
    
    if (!title) {
      return res.status(400).json({ error: 'El título del módulo es obligatorio.' });
    }
    
    // Obtener el siguiente sort_order si no se proporciona
    let order = sort_order;
    if (order === undefined) {
      const { rows } = await pool.query(
        'SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM academy_modules WHERE course_id = $1',
        [courseId]
      );
      order = rows[0].next_order;
    }
    
    const { rows } = await pool.query(`
      INSERT INTO academy_modules (course_id, title, sort_order)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [courseId, title, order]);
    
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error al crear módulo:', err);
    res.status(500).json({ error: 'Error al crear módulo.' });
  }
});

// PUT /api/admin/academy/modules/:id - Actualizar módulo
router.put('/modules/:id', async (req, res) => {
  try {
    const { title, sort_order } = req.body;
    
    const { rows } = await pool.query(`
      UPDATE academy_modules 
      SET title = COALESCE($1, title),
          sort_order = COALESCE($2, sort_order)
      WHERE id = $3
      RETURNING *
    `, [title, sort_order, req.params.id]);
    
    if (!rows.length) {
      return res.status(404).json({ error: 'Módulo no encontrado.' });
    }
    
    res.json(rows[0]);
  } catch (err) {
    console.error('Error al actualizar módulo:', err);
    res.status(500).json({ error: 'Error al actualizar módulo.' });
  }
});

// DELETE /api/admin/academy/modules/:id - Eliminar módulo
router.delete('/modules/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM academy_modules WHERE id = $1', [req.params.id]);
    
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Módulo no encontrado.' });
    }
    
    res.json({ success: true, message: 'Módulo eliminado correctamente.' });
  } catch (err) {
    console.error('Error al eliminar módulo:', err);
    res.status(500).json({ error: 'Error al eliminar módulo.' });
  }
});

// POST /api/admin/academy/modules/reorder - Reordenar módulos
router.post('/modules/reorder', async (req, res) => {
  const { modules } = req.body || {};

  // Validar ANTES de tomar la conexión (evita `idle in transaction` en el 400)
  if (!Array.isArray(modules) || modules.length === 0) {
    return res.status(400).json({ error: 'Se espera un array "modules" con [{ id, sort_order }].' });
  }
  const invalido = modules.some((m) => !m || !academy.isUuid(m.id) || !Number.isFinite(Number(m.sort_order)));
  if (invalido) {
    return res.status(400).json({ error: 'Cada entrada requiere id (UUID) y sort_order numérico.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const m of modules) {
      await client.query(
        'UPDATE academy_modules SET sort_order = $1 WHERE id = $2',
        [Number(m.sort_order), m.id]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, updated: modules.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al reordenar módulos:', err);
    res.status(500).json({ error: 'Error al reordenar módulos.' });
  } finally {
    client.release();
  }
});

// ============================================================
// LECCIONES
// ============================================================

// POST /api/admin/academy/modules/:moduleId/lessons - Crear lección
router.post('/modules/:moduleId/lessons', async (req, res) => {
  try {
    const { moduleId } = req.params;
    const { title, video_url, content_text, sort_order } = req.body;
    
    if (!title) {
      return res.status(400).json({ error: 'El título de la lección es obligatorio.' });
    }
    
    let order = sort_order;
    if (order === undefined) {
      const { rows } = await pool.query(
        'SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM academy_lessons WHERE module_id = $1',
        [moduleId]
      );
      order = rows[0].next_order;
    }
    
    const { rows } = await pool.query(`
      INSERT INTO academy_lessons (module_id, title, video_url, content_text, sort_order)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [moduleId, title, video_url || null, content_text || null, order]);
    
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error al crear lección:', err);
    res.status(500).json({ error: 'Error al crear lección.' });
  }
});

// PUT /api/admin/academy/lessons/:id - Actualizar lección
router.put('/lessons/:id', async (req, res) => {
  try {
    const { title, video_url, content_text, sort_order } = req.body;
    
    const { rows } = await pool.query(`
      UPDATE academy_lessons 
      SET title = COALESCE($1, title),
          video_url = COALESCE($2, video_url),
          content_text = COALESCE($3, content_text),
          sort_order = COALESCE($4, sort_order)
      WHERE id = $5
      RETURNING *
    `, [title, video_url, content_text, sort_order, req.params.id]);
    
    if (!rows.length) {
      return res.status(404).json({ error: 'Lección no encontrada.' });
    }
    
    res.json(rows[0]);
  } catch (err) {
    console.error('Error al actualizar lección:', err);
    res.status(500).json({ error: 'Error al actualizar lección.' });
  }
});

// DELETE /api/admin/academy/lessons/:id - Eliminar lección
router.delete('/lessons/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM academy_lessons WHERE id = $1', [req.params.id]);
    
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Lección no encontrada.' });
    }
    
    res.json({ success: true, message: 'Lección eliminada correctamente.' });
  } catch (err) {
    console.error('Error al eliminar lección:', err);
    res.status(500).json({ error: 'Error al eliminar lección.' });
  }
});

// POST /api/admin/academy/lessons/reorder - Reordenar lecciones
router.post('/lessons/reorder', async (req, res) => {
  const { lessons } = req.body || {};

  // Validar ANTES de tomar la conexión (evita `idle in transaction` en el 400)
  if (!Array.isArray(lessons) || lessons.length === 0) {
    return res.status(400).json({ error: 'Se espera un array "lessons" con [{ id, sort_order }].' });
  }
  const invalido = lessons.some((l) => !l || !academy.isUuid(l.id) || !Number.isFinite(Number(l.sort_order)));
  if (invalido) {
    return res.status(400).json({ error: 'Cada entrada requiere id (UUID) y sort_order numérico.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const l of lessons) {
      await client.query(
        'UPDATE academy_lessons SET sort_order = $1 WHERE id = $2',
        [Number(l.sort_order), l.id]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, updated: lessons.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al reordenar lecciones:', err);
    res.status(500).json({ error: 'Error al reordenar lecciones.' });
  } finally {
    client.release();
  }
});

// ============================================================
// QUIZZES
// ============================================================

// POST /api/admin/academy/courses/:courseId/quizzes - Crear pregunta de quiz
router.post('/courses/:courseId/quizzes', async (req, res) => {
  try {
    const { courseId } = req.params;
    const { question, options, correct_index } = req.body;
    
    if (!question || !options || !Array.isArray(options) || options.length < 2) {
      return res.status(400).json({ error: 'Se requiere pregunta y al menos 2 opciones.' });
    }
    if (correct_index === undefined || correct_index < 0 || correct_index >= options.length) {
      return res.status(400).json({ error: 'Índice de respuesta correcta inválido.' });
    }
    
    const { rows } = await pool.query(`
      INSERT INTO academy_quizzes (course_id, question, options, correct_index)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [courseId, question, JSON.stringify(options), correct_index]);
    
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error al crear quiz:', err);
    res.status(500).json({ error: 'Error al crear pregunta del examen.' });
  }
});

// PUT /api/admin/academy/quizzes/:id - Actualizar pregunta de quiz
router.put('/quizzes/:id', async (req, res) => {
  try {
    const { question, options, correct_index } = req.body;
    
    if (options && (!Array.isArray(options) || options.length < 2)) {
      return res.status(400).json({ error: 'Se requieren al menos 2 opciones.' });
    }
    if (correct_index !== undefined && options && (correct_index < 0 || correct_index >= options.length)) {
      return res.status(400).json({ error: 'Índice de respuesta correcta inválido.' });
    }
    
    const { rows } = await pool.query(`
      UPDATE academy_quizzes 
      SET question = COALESCE($1, question),
          options = COALESCE($2, options),
          correct_index = COALESCE($3, correct_index)
      WHERE id = $4
      RETURNING *
    `, [question, options ? JSON.stringify(options) : null, correct_index, req.params.id]);
    
    if (!rows.length) {
      return res.status(404).json({ error: 'Pregunta no encontrada.' });
    }
    
    res.json(rows[0]);
  } catch (err) {
    console.error('Error al actualizar quiz:', err);
    res.status(500).json({ error: 'Error al actualizar pregunta.' });
  }
});

// DELETE /api/admin/academy/quizzes/:id - Eliminar pregunta de quiz
router.delete('/quizzes/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM academy_quizzes WHERE id = $1', [req.params.id]);
    
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Pregunta no encontrada.' });
    }
    
    res.json({ success: true, message: 'Pregunta eliminada correctamente.' });
  } catch (err) {
    console.error('Error al eliminar quiz:', err);
    res.status(500).json({ error: 'Error al eliminar pregunta.' });
  }
});

// ============================================================
// ESTADÍSTICAS / ANALÍTICAS
// ============================================================

// GET /api/admin/academy/stats - Estadísticas generales
router.get('/stats', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM academy_courses WHERE deleted_at IS NULL) as total_courses,
        (SELECT COUNT(*) FROM academy_courses WHERE deleted_at IS NOT NULL) as archived_courses,
        (SELECT COUNT(*) FROM academy_modules) as total_modules,
        (SELECT COUNT(*) FROM academy_lessons) as total_lessons,
        (SELECT COUNT(*) FROM academy_quizzes) as total_quizzes,
        (SELECT COUNT(*) FROM academy_certificates) as total_certificates,
        (SELECT COUNT(*) FROM academy_certificates WHERE revoked = FALSE) as valid_certificates,
        (SELECT COUNT(*) FROM academy_certificates WHERE revoked = TRUE) as revoked_certificates,
        (SELECT COUNT(*) FROM academy_quiz_attempts) as total_quiz_attempts,
        (SELECT COUNT(*) FROM academy_quiz_attempts WHERE passed = TRUE) as approved_attempts,
        (SELECT COUNT(*) FROM academy_consentimientos WHERE aceptado = TRUE) as active_consents,
        (SELECT COUNT(DISTINCT provider_id) FROM academy_progress) as active_learners,
        (SELECT COUNT(*) FROM academy_progress WHERE completed = true) as completed_lessons_total
    `);
    
    // Cursos más populares (excluye archivados)
    const popularRes = await pool.query(`
      SELECT c.id, c.title, c.badge_name,
        COUNT(DISTINCT p.provider_id) as enrolled_count,
        COUNT(CASE WHEN p.completed = true THEN 1 END) as completed_count
      FROM academy_courses c
      LEFT JOIN academy_modules m ON m.course_id = c.id
      LEFT JOIN academy_lessons l ON l.module_id = m.id
      LEFT JOIN academy_progress p ON p.lesson_id = l.id
      WHERE c.deleted_at IS NULL
      GROUP BY c.id
      ORDER BY enrolled_count DESC
      LIMIT 5
    `);
    
    // Certificados por curso (vigentes y revocados)
    const certsRes = await pool.query(`
      SELECT c.title, c.badge_name,
        COUNT(cert.id) FILTER (WHERE cert.revoked = FALSE) as certificates_count,
        COUNT(cert.id) FILTER (WHERE cert.revoked = TRUE) as revoked_count
      FROM academy_certificates cert
      JOIN academy_courses c ON c.id = cert.course_id
      GROUP BY c.id
      ORDER BY certificates_count DESC
    `);
    
    res.json({
      overview: rows[0],
      popularCourses: popularRes.rows,
      certificatesByCourse: certsRes.rows
    });
  } catch (err) {
    console.error('Error al obtener stats academia:', err);
    res.status(500).json({ error: 'Error al obtener estadísticas.' });
  }
});

// ============================================================
// CERTIFICADOS (verificación, revocación y reinicio de intentos)
// ============================================================

// GET /api/admin/academy/certificates - Certificados emitidos con su estado
router.get('/certificates', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT cert.id, cert.code, cert.obtained_at, cert.revoked, cert.revoked_reason, cert.revoked_at,
           c.id as course_id, c.title as course_title, c.badge_name,
           u.id as provider_id, u.nombre as provider_name, u.email as provider_email
      FROM academy_certificates cert
      JOIN academy_courses c ON c.id = cert.course_id
      JOIN usuarios u ON u.id = cert.provider_id
     ORDER BY cert.obtained_at DESC
     LIMIT 500
  `);
  res.json(rows);
});

// POST /api/admin/academy/certificates/:code/revoke - Revocar una credencial
// (antes la única forma de "quitar" un certificado era borrarlo en cascada)
router.post('/certificates/:code/revoke', async (req, res) => {
  const reason = String((req.body && req.body.reason) || '').trim();
  if (reason.length < 5) {
    return res.status(400).json({ error: 'Se requiere un motivo de revocación (mínimo 5 caracteres).' });
  }

  const { rows } = await pool.query(`
    UPDATE academy_certificates
       SET revoked = TRUE, revoked_reason = $2, revoked_at = NOW()
     WHERE upper(code) = upper($1) AND revoked = FALSE
     RETURNING id, code, revoked_at, revoked_reason
  `, [req.params.code, reason.slice(0, 500)]);

  if (!rows.length) {
    return res.status(404).json({ error: 'Certificado no encontrado o ya revocado.' });
  }

  res.json({ ok: true, certificate: rows[0] });
});

// POST /api/admin/academy/certificates/:code/restore - Deshacer una revocación
router.post('/certificates/:code/restore', async (req, res) => {
  const { rows } = await pool.query(`
    UPDATE academy_certificates
       SET revoked = FALSE, revoked_reason = NULL, revoked_at = NULL
     WHERE upper(code) = upper($1) AND revoked = TRUE
     RETURNING id, code
  `, [req.params.code]);

  if (!rows.length) {
    return res.status(404).json({ error: 'Certificado no encontrado o no está revocado.' });
  }

  res.json({ ok: true, certificate: rows[0] });
});

// POST /api/admin/academy/providers/:providerId/courses/:courseId/reset-attempts
// Reinicia los intentos de examen de una alumna (soporte).
router.post('/providers/:providerId/courses/:courseId/reset-attempts', async (req, res) => {
  const providerId = parseInt(req.params.providerId, 10);
  const { courseId } = req.params;

  if (!Number.isInteger(providerId) || !academy.isUuid(courseId)) {
    return res.status(400).json({ error: 'Parámetros inválidos: providerId numérico y courseId UUID.' });
  }

  const { rowCount } = await pool.query(
    'DELETE FROM academy_quiz_attempts WHERE provider_id = $1 AND course_id = $2',
    [providerId, courseId]
  );

  res.json({ ok: true, attemptsRemoved: rowCount });
});

// Express 4: envolver las capas del router para que los rechazos async lleguen a next()
wrapRouterAsync(router);

module.exports = router;
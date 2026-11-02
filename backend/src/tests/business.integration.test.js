/**
 * GLOWAPP BUSINESS INTEGRATION TEST SUITE (GOAL 04 — Phase D P0 Security & DB Verification)
 * Tests Business Engine REST API endpoints, P0 Authentication, IDOR protection, Admin RBAC, and DB repository persistence.
 */

const request = require('supertest');
const express = require('express');
const businessRoutes = require('../routes/businessRoutes');

const { Membership, BusinessProfile } = require('../models');

const app = express();
app.use(express.json());

// Mock Auth Middleware Simulator for Integration Test Suite
app.use((req, res, next) => {
  const authHeader = req.headers.authorization || '';
  if (authHeader === 'Bearer provider-token-user-a') {
    req.user = { id: 101, role: 'provider', tenant_id: 'tenant-alpha' };
  } else if (authHeader === 'Bearer provider-token-user-b') {
    req.user = { id: 102, role: 'provider', tenant_id: 'tenant-beta' };
  } else if (authHeader === 'Bearer admin-token') {
    req.user = { id: 999, role: 'admin', tenant_id: 'tenant-system' };
  }
  next();
});

app.use('/api/v1/business', businessRoutes);

describe('GlowApp Business Engine Integration & P0 Security Suite', () => {
  let createdTaskId = null;
  let createdEvidenceId = null;

  beforeAll(async () => {
    try {
      await BusinessProfile.create({ id: 'biz-alpha', name: 'Peluquería Alpha', city: 'Bogotá' });
      await BusinessProfile.create({ id: 'biz-beta', name: 'Peluquería Beta', city: 'Medellín' });
    } catch (e) {}

    try {
      await Membership.create({ id: 'm-101', user_id: 101, business_profile_id: 'biz-alpha', role: 'OWNER', status: 'ACTIVE' });
      await Membership.create({ id: 'm-102', user_id: 102, business_profile_id: 'biz-beta', role: 'OWNER', status: 'ACTIVE' });
      await Membership.create({ id: 'm-999', user_id: 999, business_profile_id: 'biz-alpha', role: 'ADMIN', status: 'ACTIVE' });
    } catch (e) {}
  });

  test('1. GET /api/v1/business/verticals - Catalogo publico sin requerir autenticacion (200)', async () => {
    const res = await request(app).get('/api/v1/business/verticals');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0]).toHaveProperty('code');
  });

  test('2. POST /api/v1/business/diagnostic - Rechaza peticion sin token JWT (401)', async () => {
    const res = await request(app)
      .post('/api/v1/business/diagnostic')
      .send({
        name: 'Peluquería Sin Auth',
        onboarding_mode: 'NEW_BUSINESS',
        vertical_code: 'BEAUTY_SALON'
      });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  test('3. POST /api/v1/business/diagnostic - Ejecuta diagnostico de Puerta 1 con usuario autenticado (200)', async () => {
    const res = await request(app)
      .post('/api/v1/business/diagnostic')
      .set('Authorization', 'Bearer provider-token-user-a')
      .send({
        name: 'Salón Éxito Alpha',
        onboarding_mode: 'NEW_BUSINESS',
        vertical_code: 'BEAUTY_SALON',
        city: 'Bogotá'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(String(res.body.data.profile.provider_id)).toBe('101');
    expect(res.body.data.profile.onboarding_mode).toBe('NEW_BUSINESS');
    expect(Array.isArray(res.body.data.tasks)).toBe(true);
    expect(res.body.data.tasks.length).toBeGreaterThan(0);

    createdTaskId = res.body.data.tasks[0].id;
  });

  test('4. GET /api/v1/business/summary - Retorna resumen de cumplimiento para el usuario (200)', async () => {
    const res = await request(app)
      .get('/api/v1/business/summary')
      .set('Authorization', 'Bearer provider-token-user-a');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(String(res.body.data.profile.provider_id)).toBe('101');
    expect(res.body.data).toHaveProperty('tasksCount');
  });

  test('5. POST /api/v1/business/tasks/:id/advance - Permite avanzar etapa a tarea propia (200)', async () => {
    expect(createdTaskId).toBeTruthy();

    const res = await request(app)
      .post(`/api/v1/business/tasks/${createdTaskId}/advance`)
      .set('Authorization', 'Bearer provider-token-user-a')
      .send({ action: 'NEXT', notes: 'Avanzando a EXPLICAR' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.stage).toBe('EXPLICAR');
  });

  test('6. BUS-SEC-002: IDOR Rejection - Usuario B no puede modificar tarea perteneciente a Usuario A (403)', async () => {
    expect(createdTaskId).toBeTruthy();

    const res = await request(app)
      .post(`/api/v1/business/tasks/${createdTaskId}/advance`)
      .set('Authorization', 'Bearer provider-token-user-b')
      .send({ action: 'NEXT' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('FORBIDDEN');
  });

  test('7. POST /api/v1/business/tasks/:id/evidence - Registra evidencia para tarea propia (200)', async () => {
    expect(createdTaskId).toBeTruthy();

    const res = await request(app)
      .post(`/api/v1/business/tasks/${createdTaskId}/evidence`)
      .set('Authorization', 'Bearer provider-token-user-a')
      .attach('file', Buffer.from('PDF Manual Content'), 'manual_bioseguridad.pdf')
      .field('evidence_type', 'DOCUMENT')
      .field('notes', 'Carga de manual bioseguridad en PDF');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.validation_state).toBe('EVIDENCE_SUBMITTED');
    expect(res.body.data.evidence).toHaveProperty('id');

    createdEvidenceId = res.body.data.evidence.id;
  });

  test('8. GET /api/v1/business/admin/queue - Rechaza acceso a prestador no admin (403)', async () => {
    const res = await request(app)
      .get('/api/v1/business/admin/queue')
      .set('Authorization', 'Bearer provider-token-user-a');

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
  });

  test('9. GET /api/v1/business/admin/queue - Permite acceso a usuario Administrador (200)', async () => {
    const res = await request(app)
      .get('/api/v1/business/admin/queue')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('10. PUT /api/v1/business/admin/evidence/:id - Administrador aprueba evidencia (200)', async () => {
    expect(createdEvidenceId).toBeTruthy();

    const res = await request(app)
      .put(`/api/v1/business/admin/evidence/${createdEvidenceId}`)
      .set('Authorization', 'Bearer admin-token')
      .send({
        action: 'APPROVED',
        notes: 'Aprobado tras verificacion de folios de bioseguridad'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.validationState).toBe('EVIDENCE_VALIDATED');
    expect(res.body.data.taskStatus).toBe('VERIFIED');
  });

  test('11. POST /api/v1/business/documents/generate - Genera borrador documental con marca de agua (200)', async () => {
    const res = await request(app)
      .post('/api/v1/business/documents/generate')
      .set('Authorization', 'Bearer provider-token-user-a')
      .send({
        template_code: 'TPL_LABOR_CONTRACT_BEAUTY',
        variables: {
          employer_name: 'Peluquería Alpha SAS',
          employee_name: 'Carlos Ruiz',
          job_title: 'Estilista Senior',
          salary: '$ 2.500.000 COP'
        }
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.renderedBody).toContain('Peluquería Alpha SAS');
    expect(res.body.data.renderedBody).toContain('Carlos Ruiz');
    expect(res.body.data.watermark).toContain('BORRADOR DE TRABAJO');
    expect(res.body.data.disclaimer).toContain('ADVERTENCIA LEGAL');
  });
});

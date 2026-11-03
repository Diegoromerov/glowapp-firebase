/**
 * GLOWAPP BUSINESS ADMIN UI & DOCUMENTS / RENDERING / SIGNATURE INTEGRATION TEST SUITE
 * Verifies Document Generation, Persistence, Versioning, Download Authorization, Tenant Isolation, and Electronic Signatures (GOAL 06).
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

describe('GlowApp Business Engine — GOAL 06 Admin UI & Document Rendering & Signature Suite', () => {
  let createdDocId = null;

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

  test('TEST 01: Generación y renderizado real de borrador documental (200)', async () => {
    const res = await request(app)
      .post('/api/v1/business/documents/generate')
      .set('Authorization', 'Bearer provider-token-user-a')
      .send({
        template_code: 'TPL_LABOR_CONTRACT_BEAUTY',
        variables: {
          employer_name: 'Peluquería Alpha SAS',
          employee_name: 'Laura Gómez',
          job_title: 'Estilista Profesional',
          salary: '$ 2.200.000 COP'
        }
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('documentId');
    expect(res.body.data.renderedBody).toContain('Peluquería Alpha SAS');
    expect(res.body.data.renderedBody).toContain('Laura Gómez');
    expect(res.body.data.watermark).toContain('BORRADOR DE TRABAJO');

    createdDocId = res.body.data.documentId;
  });

  test('TEST 02: Interpolación de variables del negocio en el cuerpo del documento', async () => {
    expect(createdDocId).toBeTruthy();

    const res = await request(app)
      .get(`/api/v1/business/documents/${createdDocId}/download`)
      .set('Authorization', 'Bearer provider-token-user-a');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.rendered_body).toContain('Peluquería Alpha SAS');
  });

  test('TEST 03: Persistencia del documento generado con estado DRAFT y versión 1', async () => {
    expect(createdDocId).toBeTruthy();

    const res = await request(app)
      .get(`/api/v1/business/documents/${createdDocId}/download`)
      .set('Authorization', 'Bearer provider-token-user-a');

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.version).toBe(1);
  });

  test('TEST 04: Recuperación exitosa del documento por ID', async () => {
    expect(createdDocId).toBeTruthy();

    const res = await request(app)
      .get(`/api/v1/business/documents/${createdDocId}/download`)
      .set('Authorization', 'Bearer provider-token-user-a');

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(createdDocId);
  });

  test('TEST 05: Usuario autorizado descarga versión HTML formateada (200)', async () => {
    expect(createdDocId).toBeTruthy();

    const res = await request(app)
      .get(`/api/v1/business/documents/${createdDocId}/download?format=html`)
      .set('Authorization', 'Bearer provider-token-user-a');

    expect(res.status).toBe(200);
    expect(res.text).toContain('<!DOCTYPE html>');
    expect(res.text).toContain('Peluquería Alpha SAS');
  });

  test('TEST 06: Petición de descarga sin autenticación es rechazada (401)', async () => {
    expect(createdDocId).toBeTruthy();

    const res = await request(app)
      .get(`/api/v1/business/documents/${createdDocId}/download`);

    expect(res.status).toBe(401);
  });

  test('TEST 07: Cross-Tenant Protection - Usuario de Tenant B no puede descargar documento de Tenant A (403)', async () => {
    expect(createdDocId).toBeTruthy();

    const res = await request(app)
      .get(`/api/v1/business/documents/${createdDocId}/download`)
      .set('Authorization', 'Bearer provider-token-user-b');

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('FORBIDDEN');
  });

  test('TEST 08: Flujo completo de Firma Electrónica (DRAFT -> PENDING_SIGNATURE -> SIGNED)', async () => {
    expect(createdDocId).toBeTruthy();

    // 1. Solicitud de firma
    const reqSigRes = await request(app)
      .post(`/api/v1/business/documents/${createdDocId}/request-signature`)
      .set('Authorization', 'Bearer provider-token-user-a');

    expect(reqSigRes.status).toBe(200);
    expect(reqSigRes.body.data.status).toBe('PENDING_SIGNATURE');

    // 2. Firma del documento por el prestador
    const signRes = await request(app)
      .post(`/api/v1/business/documents/${createdDocId}/sign`)
      .set('Authorization', 'Bearer provider-token-user-a')
      .send({
        signer_name: 'Peluquería Alpha Rep. Legal'
      });

    expect(signRes.status).toBe(200);
    expect(signRes.body.data.status).toBe('SIGNED');
    expect(signRes.body.data.signedBy).toBe('Peluquería Alpha Rep. Legal');
    expect(signRes.body.data).toHaveProperty('signatureHash');
  });
});

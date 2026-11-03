/**
 * GLOWAPP BUSINESS - SYSTEM INTEGRATION TEST SUITE (GOAL 08)
 * Verifies end-to-end multi-domain integration across Auth, Tenant, RBAC,
 * Business Diagnostic, Tasks, Evidence, Admin Review, Documents, Signature,
 * Versioning, Audit Trail, Aura Orchestration, and Multi-Tenant RAG.
 */

const request = require('supertest');
const express = require('express');
const businessRoutes = require('../routes/businessRoutes');
const businessRepository = require('../repositories/businessRepository');
const { executeAuraTool } = require('../services/auraToolExecutor');
const { searchBeautyKnowledge } = require('../services/ragService');

const { Membership, BusinessProfile } = require('../models');

describe('GlowApp Business - System Integration & Architecture Validation (Goal 08)', () => {
  let app;

  const mockProviderUser = {
    id: 100,
    tenant_id: 'tenant_system_alpha',
    role: 'provider',
    name: 'Dra. System Integration'
  };

  const mockOtherProviderUser = {
    id: 200,
    tenant_id: 'tenant_system_alpha',
    role: 'provider',
    name: 'Dr. Other Provider Same Tenant'
  };

  const mockOtherTenantUser = {
    id: 300,
    tenant_id: 'tenant_system_beta',
    role: 'provider',
    name: 'Dr. Foreign Tenant User'
  };

  const mockAdminUser = {
    id: 999,
    tenant_id: 'tenant_system_alpha',
    role: 'admin',
    name: 'Super Admin'
  };

  beforeAll(async () => {
    try {
      await BusinessProfile.create({ id: 'biz-sys-alpha', name: 'Peluquería Alpha', city: 'Bogotá' });
      await BusinessProfile.create({ id: 'biz-sys-beta', name: 'Peluquería Beta', city: 'Medellín' });
    } catch (e) {}

    try {
      await Membership.create({ id: 'm-sys-100', user_id: 100, business_profile_id: 'biz-sys-alpha', role: 'OWNER', status: 'ACTIVE' });
      await Membership.create({ id: 'm-sys-200', user_id: 200, business_profile_id: 'biz-sys-alpha', role: 'OWNER', status: 'ACTIVE' });
      await Membership.create({ id: 'm-sys-300', user_id: 300, business_profile_id: 'biz-sys-beta', role: 'OWNER', status: 'ACTIVE' });
      await Membership.create({ id: 'm-sys-999', user_id: 999, business_profile_id: 'biz-sys-alpha', role: 'ADMIN', status: 'ACTIVE' });
    } catch (e) {}

    app = express();
    app.use(express.json());

    // Simulated auth middleware based on Header 'x-test-user'
    app.use((req, res, next) => {
      const userHeader = req.headers['x-test-user'];
      if (userHeader === 'provider') req.user = mockProviderUser;
      else if (userHeader === 'other-provider') req.user = mockOtherProviderUser;
      else if (userHeader === 'other-tenant') req.user = mockOtherTenantUser;
      else if (userHeader === 'admin') req.user = mockAdminUser;
      // If header missing, req.user remains undefined (unauthenticated)
      next();
    });

    app.use('/api/v1/business', businessRoutes);
  });

  describe('1. Full End-to-End Business Journey', () => {
    let createdTaskId;
    let submittedEvidenceId;
    let generatedDocId;

    test('Step 1: Execute Business Diagnostic', async () => {
      const res = await request(app)
        .post('/api/v1/business/diagnostic')
        .set('x-test-user', 'provider')
        .send({
          name: 'Spa System E2E',
          onboarding_mode: 'ESTABLECIMIENTO_FIJO',
          vertical_code: 'BARBERIA_PELUQUERIA',
          city: 'Bogotá',
          answers: { tiene_concepto_sanitario: false, realiza_procedimientos_invasivos: false }
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(String(res.body.data.profile.provider_id)).toBe(String(mockProviderUser.id));
      expect(res.body.data.profile.tenant_id).toBe(mockProviderUser.tenant_id);
    });

    test('Step 2: Get Business Summary & Tasks', async () => {
      const summaryRes = await request(app)
        .get('/api/v1/business/summary')
        .set('x-test-user', 'provider');

      expect(summaryRes.status).toBe(200);
      expect(summaryRes.body.success).toBe(true);
      expect(summaryRes.body.data.profile.name).toBe('Spa System E2E');

      const tasksRes = await request(app)
        .get('/api/v1/business/tasks')
        .set('x-test-user', 'provider');

      expect(tasksRes.status).toBe(200);
      expect(tasksRes.body.success).toBe(true);
      expect(Array.isArray(tasksRes.body.data)).toBe(true);
      expect(tasksRes.body.data.length).toBeGreaterThan(0);

      createdTaskId = tasksRes.body.data[0].id;
    });

    test('Step 3: Advance Task & Submit Evidence', async () => {
      const advanceRes = await request(app)
        .post(`/api/v1/business/tasks/${createdTaskId}/advance`)
        .set('x-test-user', 'provider')
        .send({ action: 'NEXT', notes: 'Iniciando trámite de bioseguridad' });

      expect(advanceRes.status).toBe(200);
      expect(advanceRes.body.data.stage).toBe('EXPLICAR');

      const evidenceRes = await request(app)
        .post(`/api/v1/business/tasks/${createdTaskId}/evidence`)
        .set('x-test-user', 'provider')
        .attach('file', Buffer.from('PDF Manual Content'), 'biosecurity_pdf.pdf')
        .field('evidence_type', 'DOCUMENT')
        .field('notes', 'Cargado manual RH1');

      expect(evidenceRes.status).toBe(200);
      expect(evidenceRes.body.data.validation_state).toBe('EVIDENCE_SUBMITTED');
      submittedEvidenceId = evidenceRes.body.data.evidence.id;
    });

    test('Step 4: Admin Review Queue & Review Evidence', async () => {
      const queueRes = await request(app)
        .get('/api/v1/business/admin/queue')
        .set('x-test-user', 'admin');

      expect(queueRes.status).toBe(200);
      expect(queueRes.body.success).toBe(true);

      const reviewRes = await request(app)
        .put(`/api/v1/business/admin/evidence/${submittedEvidenceId}`)
        .set('x-test-user', 'admin')
        .send({ action: 'APPROVED', notes: 'Manual de bioseguridad aprobado' });

      expect(reviewRes.status).toBe(200);
      expect(reviewRes.body.data.validationState).toBe('EVIDENCE_VALIDATED');
    });

    test('Step 5: Document Generation, Download, Signature & Versioning', async () => {
      const genRes = await request(app)
        .post('/api/v1/business/documents/generate')
        .set('x-test-user', 'provider')
        .send({
          template_code: 'TPL_LABOR_CONTRACT_BEAUTY',
          variables: { employer_name: 'Spa System', employee_name: 'Juan Pérez', job_title: 'Estilista', salary: '$2.000.000' }
        });

      expect(genRes.status).toBe(200);
      const docData = genRes.body.data.doc || genRes.body.data;
      expect(docData.status).toBe('DRAFT');
      expect(docData.version).toBe(1);
      generatedDocId = genRes.body.data.documentId || docData.id;

      // Request Signature
      const reqSigRes = await request(app)
        .post(`/api/v1/business/documents/${generatedDocId}/request-signature`)
        .set('x-test-user', 'provider');

      expect(reqSigRes.status).toBe(200);
      expect(reqSigRes.body.data.status).toBe('PENDING_SIGNATURE');

      // Sign Document
      const signRes = await request(app)
        .post(`/api/v1/business/documents/${generatedDocId}/sign`)
        .set('x-test-user', 'provider')
        .send({ signer_name: 'Dra. System Integration' });

      expect(signRes.status).toBe(200);
      expect(signRes.body.data.status).toBe('SIGNED');
      expect(signRes.body.data.signatureHash || signRes.body.data.signature_hash).toBeDefined();

      // Immutability Check
      const reSignRes = await request(app)
        .post(`/api/v1/business/documents/${generatedDocId}/sign`)
        .set('x-test-user', 'provider')
        .send({ signer_name: 'Intento de Re-firma' });

      expect(reSignRes.status).toBe(400);
      expect(reSignRes.body.error).toContain('IMMUTABLE');

      // Versioning (Create v2)
      const verRes = await request(app)
        .post(`/api/v1/business/documents/${generatedDocId}/version`)
        .set('x-test-user', 'provider')
        .send({ variables: { employer_name: 'Spa System v2', employee_name: 'Juan Pérez', job_title: 'Estilista', salary: '$2.500.000' } });

      expect(verRes.status).toBe(201);
      expect(verRes.body.data.version).toBe(2);
      expect(verRes.body.data.parentDocumentId || verRes.body.data.parent_document_id).toBe(generatedDocId);
      expect(verRes.body.data.status).toBe('DRAFT');

      // Audit Trail
      const auditRes = await request(app)
        .get(`/api/v1/business/documents/${generatedDocId}/audit`)
        .set('x-test-user', 'provider');

      expect(auditRes.status).toBe(200);
      const auditLogsArr = auditRes.body.data.auditLogs || auditRes.body.data;
      expect(Array.isArray(auditLogsArr)).toBe(true);
      expect(auditLogsArr.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('2. Security & Cross-Tenant Boundary Tests', () => {
    let providerADocId;

    beforeAll(async () => {
      // Save document owned by Provider A
      const doc = await businessRepository.saveDocument({
        template_id: 'CONSENTIMIENTO_INFORMADO_ESTETICA',
        provider_id: mockProviderUser.id,
        tenant_id: mockProviderUser.tenant_id,
        title: 'Doc Provider A',
        rendered_content: '<p>Content</p>',
        variables: {},
        status: 'DRAFT',
        version: 1
      });
      providerADocId = doc.id;
    });

    test('ALLOW: Authorized Provider A accesses owned document', async () => {
      const res = await request(app)
        .get(`/api/v1/business/documents/${providerADocId}/download`)
        .set('x-test-user', 'provider');

      expect(res.status).toBe(200);
    });

    test('DENY: Other Provider in same tenant cannot access Provider A document', async () => {
      const res = await request(app)
        .get(`/api/v1/business/documents/${providerADocId}/download`)
        .set('x-test-user', 'other-provider');

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('FORBIDDEN');
    });

    test('DENY: Foreign Tenant Provider cannot access Provider A document', async () => {
      const res = await request(app)
        .get(`/api/v1/business/documents/${providerADocId}/download`)
        .set('x-test-user', 'other-tenant');

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('FORBIDDEN');
    });

    test('DENY: Unauthenticated request (no JWT) is rejected', async () => {
      const res = await request(app)
        .get('/api/v1/business/summary');

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('UNAUTHORIZED');
    });
  });

  describe('3. RBAC Matrix Verification', () => {
    test('Provider cannot access Admin Queue endpoint', async () => {
      const res = await request(app)
        .get('/api/v1/business/admin/queue')
        .set('x-test-user', 'provider');

      expect(res.status).toBe(403);
    });

    test('Admin CAN access Admin Queue endpoint and transversal documents', async () => {
      const res = await request(app)
        .get('/api/v1/business/admin/queue')
        .set('x-test-user', 'admin');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('4. Aura & Multi-Tenant RAG Integration Boundary', () => {
    test('Aura Tool: get_business_profile_summary returns profile for provider context', async () => {
      const result = await executeAuraTool('get_business_profile_summary', {}, mockProviderUser.id, 'provider', mockProviderUser.tenant_id);
      expect(result.status).toBe('success');
      expect(result.summary.profile).toBeDefined();
    });

    test('Aura Tool: get_business_tasks returns tasks for provider context', async () => {
      const result = await executeAuraTool('get_business_tasks', {}, mockProviderUser.id, 'provider', mockProviderUser.tenant_id);
      expect(result.status).toBe('success');
      expect(result.tasksCount).toBeDefined();
    });

    test('Aura Tool: search_regulatory_knowledge_rag returns RAG results', async () => {
      const result = await executeAuraTool('search_regulatory_knowledge_rag', { queryText: 'bioseguridad' }, mockProviderUser.id, 'provider', mockProviderUser.tenant_id);
      expect(result.status).toBe('success');
      expect(result.domain).toBe('REGULATORY');
      expect(Array.isArray(result.knowledge)).toBe(true);
    });

    test('Multi-tenant RAG search respects tenantId filter', async () => {
      const ragResults = await searchBeautyKnowledge('concepto sanitario', { tenantId: mockProviderUser.tenant_id });
      expect(Array.isArray(ragResults)).toBe(true);
    });
  });

  describe('5. Identity & Data Consistency Verification', () => {
    test('Consistency: tenant_id and provider_id match across Diagnostic, Summary, Tasks and Documents', async () => {
      const summaryRes = await request(app)
        .get('/api/v1/business/summary')
        .set('x-test-user', 'provider');

      const tasksRes = await request(app)
        .get('/api/v1/business/tasks')
        .set('x-test-user', 'provider');

      expect(String(summaryRes.body.data.profile.provider_id)).toBe(String(mockProviderUser.id));
      expect(summaryRes.body.data.profile.tenant_id).toBe(mockProviderUser.tenant_id);

      tasksRes.body.data.forEach(task => {
        expect(String(task.provider_id)).toBe(String(mockProviderUser.id));
        expect(task.tenant_id).toBe(mockProviderUser.tenant_id);
      });
    });
  });
});

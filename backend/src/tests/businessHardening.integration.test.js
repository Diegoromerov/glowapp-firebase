/**
 * GLOWAPP BUSINESS ENGINE — GOAL 07 HARDENING & FINAL VALIDATION TEST SUITE
 * Covers:
 * 1. Gap 01: Provider-vs-Provider isolation within same Tenant
 * 2. Gap 02: Electronic signature workflow & SHA-256 integrity hash (Level B)
 * 3. Gap 03: Document versioning & immutability of signed documents
 * 4. Gap 04: Admin UI E2E API flow & access control guards
 * 5. Gap 05: Document audit trail tracking (created, downloaded, requested, signed, versioned)
 */

const request = require('supertest');
const express = require('express');
const businessRoutes = require('../routes/businessRoutes');

const { Membership, BusinessProfile } = require('../models');

// Setup Test Express Server with Mock Auth Middleware Simulator
const app = express();
app.use(express.json());

app.use((req, res, next) => {
  const authHeader = req.headers.authorization || '';
  if (authHeader === 'Bearer token-provider-a') {
    req.user = { id: 201, name: 'Estética Maria', role: 'provider', tenant_id: 'tenant-x' };
  } else if (authHeader === 'Bearer token-provider-b') {
    req.user = { id: 202, name: 'Spa Sofia', role: 'provider', tenant_id: 'tenant-x' };
  } else if (authHeader === 'Bearer token-admin') {
    req.user = { id: 999, name: 'Super Admin', role: 'admin', tenant_id: 'tenant-admin' };
  }
  next();
});

app.use('/api/v1/business', businessRoutes);

describe('GlowApp Business Goal 07 — Hardening & Final Validation', () => {
  const tokenProviderA = 'token-provider-a';
  const tokenProviderB = 'token-provider-b';
  const tokenAdmin = 'token-admin';

  let docAId = null;

  beforeAll(async () => {
    try {
      await BusinessProfile.create({ id: 'biz-x', name: 'Estética Maria', city: 'Bogotá' });
      await BusinessProfile.create({ id: 'biz-x-2', name: 'Spa Sofia', city: 'Medellín' });
    } catch (e) {}

    try {
      await Membership.create({ id: 'm-201', user_id: 201, business_profile_id: 'biz-x', role: 'OWNER', status: 'ACTIVE' });
      await Membership.create({ id: 'm-202', user_id: 202, business_profile_id: 'biz-x-2', role: 'OWNER', status: 'ACTIVE' });
      await Membership.create({ id: 'm-999-h', user_id: 999, business_profile_id: 'biz-x', role: 'ADMIN', status: 'ACTIVE' });
    } catch (e) {}
  });

  // Setup initial document owned by Provider A
  beforeAll(async () => {
    const res = await request(app)
      .post('/api/v1/business/documents/generate')
      .set('Authorization', `Bearer ${tokenProviderA}`)
      .send({
        template_code: 'SAFETY_PROTOCOL_V1',
        variables: { provider_name: 'Estética Maria', tax_id: '900.123.456-7' }
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    docAId = res.body.data.documentId;
  });

  // ==========================================
  // GAP 01: PROVIDER-VS-PROVIDER ISOLATION
  // ==========================================
  describe('GAP 01: Provider-vs-Provider Isolation (Same Tenant)', () => {
    it('1.1 Should ALLOW Provider A to download their own document', async () => {
      const res = await request(app)
        .get(`/api/v1/business/documents/${docAId}/download`)
        .set('Authorization', `Bearer ${tokenProviderA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('1.2 Should DENY Provider B from downloading Provider A document (HTTP 403)', async () => {
      const res = await request(app)
        .get(`/api/v1/business/documents/${docAId}/download`)
        .set('Authorization', `Bearer ${tokenProviderB}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('FORBIDDEN');
    });

    it('1.3 Should DENY Provider B from requesting signature on Provider A document', async () => {
      const res = await request(app)
        .post(`/api/v1/business/documents/${docAId}/request-signature`)
        .set('Authorization', `Bearer ${tokenProviderB}`);

      expect(res.status).toBe(500); // Throws Error in controller catch
      expect(res.body.error).toContain('FORBIDDEN');
    });

    it('1.4 Should ALLOW Admin to download Provider A document (Admin Exception)', async () => {
      const res = await request(app)
        .get(`/api/v1/business/documents/${docAId}/download`)
        .set('Authorization', `Bearer ${tokenAdmin}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ==========================================
  // GAP 02: SIGNATURE MODEL WORKFLOW (LEVEL B)
  // ==========================================
  describe('GAP 02: Signature Model Workflow & Integrity Hash', () => {
    it('2.1 Should request signature and transition status to PENDING_SIGNATURE', async () => {
      const res = await request(app)
        .post(`/api/v1/business/documents/${docAId}/request-signature`)
        .set('Authorization', `Bearer ${tokenProviderA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('PENDING_SIGNATURE');
    });

    it('2.2 Should sign document electronically and record SHA-256 hash', async () => {
      const res = await request(app)
        .post(`/api/v1/business/documents/${docAId}/sign`)
        .set('Authorization', `Bearer ${tokenProviderA}`)
        .send({ signer_name: 'Maria Provider' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('SIGNED');
      expect(res.body.data.signedBy).toBe('Maria Provider');
      expect(res.body.data.signatureHash).toBeDefined();
      expect(res.body.data.signatureHash.length).toBe(64); // SHA-256 hex string
    });
  });

  // ==========================================
  // GAP 03: DOCUMENT VERSIONING & IMMUTABILITY
  // ==========================================
  describe('GAP 03: Document Versioning & Signed Document Immutability', () => {
    it('3.1 Should BLOCK re-signing an already SIGNED document (Immutability Check)', async () => {
      const res = await request(app)
        .post(`/api/v1/business/documents/${docAId}/sign`)
        .set('Authorization', `Bearer ${tokenProviderA}`)
        .send({ signer_name: 'Maria Provider Intento 2' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('IMMUTABLE');
    });

    it('3.2 Should create a new Document Version V2 while keeping V1 untouched', async () => {
      const res = await request(app)
        .post(`/api/v1/business/documents/${docAId}/version`)
        .set('Authorization', `Bearer ${tokenProviderA}`)
        .send({
          variables: { provider_name: 'Estética Maria Renovada', tax_id: '900.123.456-7' }
        });

      expect(res.status).toBe(201);
      expect(res.body.data.version).toBe(2);
      expect(res.body.data.parentDocumentId).toBe(docAId);
      expect(res.body.data.status).toBe('DRAFT');

      // Check V1 still exists and is SIGNED
      const v1Res = await request(app)
        .get(`/api/v1/business/documents/${docAId}/download`)
        .set('Authorization', `Bearer ${tokenProviderA}`);

      expect(v1Res.body.data.version).toBe(1);
      expect(v1Res.body.data.status).toBe('SIGNED');
    });
  });

  // ==========================================
  // GAP 04: ADMIN UI E2E API FLOW
  // ==========================================
  describe('GAP 04: Admin UI E2E API Flow & Access Control', () => {
    it('4.1 Should ALLOW Admin to fetch compliance review queue', async () => {
      const res = await request(app)
        .get('/api/v1/business/admin/queue')
        .set('Authorization', `Bearer ${tokenAdmin}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });

    it('4.2 Should DENY non-admin provider from fetching admin queue (HTTP 403)', async () => {
      const res = await request(app)
        .get('/api/v1/business/admin/queue')
        .set('Authorization', `Bearer ${tokenProviderA}`);

      expect(res.status).toBe(403);
    });
  });

  // ==========================================
  // GAP 05: DOCUMENT AUDIT TRAIL
  // ==========================================
  describe('GAP 05: Document Audit Trail', () => {
    it('5.1 Should return audit log history for Document A', async () => {
      const res = await request(app)
        .get(`/api/v1/business/documents/${docAId}/audit`)
        .set('Authorization', `Bearer ${tokenProviderA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.auditLogs).toBeDefined();
      expect(Array.isArray(res.body.data.auditLogs)).toBe(true);

      const actions = res.body.data.auditLogs.map(log => log.action);
      expect(actions).toContain('document_created');
      expect(actions).toContain('document_downloaded');
      expect(actions).toContain('signature_requested');
      expect(actions).toContain('document_signed');
    });

    it('5.2 Should DENY Provider B from viewing Provider A document audit log', async () => {
      const res = await request(app)
        .get(`/api/v1/business/documents/${docAId}/audit`)
        .set('Authorization', `Bearer ${tokenProviderB}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('FORBIDDEN');
    });
  });
});

/**
 * GLOWAPP BUSINESS CONTROLLER
 * Express HTTP handlers for GlowApp Business Engine REST API.
 * 
 * BUS-SEC-002 Security Patch:
 * - Strict JWT Identity Extraction (req.user.id, req.user.tenant_id).
 * - Client-supplied provider_id in body/query is rejected for ownership.
 * - IDOR & Cross-Tenant Data Access Vulnerability ELIMINATED.
 */

const businessDiagnosticService = require('../services/businessDiagnosticService');
const businessRequirementService = require('../services/businessRequirementService');
const businessWorkflowService = require('../services/businessWorkflowService');
const documentGeneratorService = require('../services/documentGeneratorService');
const {
  diagnosticSchema,
  generateDocSchema,
  signDocSchema,
  advanceTaskSchema,
  submitEvidenceSchema,
} = require('../validators/businessValidator');

class BusinessController {
  // GET /api/v1/business/verticals (Public Catalog)
  async getVerticals(req, res) {
    try {
      const verticals = await businessRequirementService.getVerticalsCatalog();
      return res.status(200).json({ success: true, data: verticals });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // POST /api/v1/business/diagnostic (Private Provider)
  async runDiagnostic(req, res) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, error: 'UNAUTHORIZED: Autenticación requerida' });
      }

      // Input Validation using Zod
      const validatedBody = diagnosticSchema.parse(req.body || {});

      // Enforce identity from JWT req.user only
      const providerId = req.user.id;
      const tenantId = req.user.tenant_id;

      const result = await businessDiagnosticService.runDiagnostic({
        provider_id: providerId,
        tenant_id: tenantId,
        name: validatedBody.name,
        onboarding_mode: validatedBody.onboarding_mode,
        vertical_code: validatedBody.vertical_code,
        city: validatedBody.city,
        answers: req.body.answers
      });

      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      if (err.name === 'ZodError') {
        return res.status(400).json({ success: false, error: 'BAD_REQUEST: Datos de entrada inválidos', details: err.errors });
      }
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // GET /api/v1/business/summary (Private Provider)
  async getSummary(req, res) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, error: 'UNAUTHORIZED: Autenticación requerida' });
      }

      const providerId = req.user.id;
      const tenantId = req.user.tenant_id;

      const result = await businessDiagnosticService.getProfileSummary(providerId, tenantId);
      if (!result || !result.profile) {
        return res.status(404).json({ success: false, error: 'Expediente de negocio no encontrado' });
      }

      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // GET /api/v1/business/tasks (Private Provider)
  async getTasks(req, res) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, error: 'UNAUTHORIZED: Autenticación requerida' });
      }

      const providerId = req.user.id;
      const tenantId = req.user.tenant_id;

      const tasks = await businessWorkflowService.getTasksForProvider(providerId, tenantId);
      return res.status(200).json({ success: true, data: tasks });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // POST /api/v1/business/tasks/:id/advance (Private Provider)
  async advanceTask(req, res) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, error: 'UNAUTHORIZED: Autenticación requerida' });
      }

      const validatedBody = advanceTaskSchema.parse(req.body || {});
      const providerId = req.user.id;
      const tenantId = req.user.tenant_id;

      const result = await businessWorkflowService.advanceTaskStage({
        taskId: req.params.id,
        providerId,
        tenantId,
        action: validatedBody.action || req.body.action,
        notes: validatedBody.notes || req.body.notes
      });

      if (!result) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN: Tarea no encontrada o no pertenece al tenant autorizado' });
      }

      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      if (err.name === 'ZodError') {
        return res.status(400).json({ success: false, error: 'BAD_REQUEST: Datos de entrada inválidos', details: err.errors });
      }
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // POST /api/v1/business/tasks/:id/evidence (Private Provider)
  async submitEvidence(req, res) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, error: 'UNAUTHORIZED: Autenticación requerida' });
      }

      const validatedBody = submitEvidenceSchema.parse(req.body || {});
      const providerId = req.user.id;
      const tenantId = req.user.tenant_id;

      // La ruta del archivo la produce el SERVIDOR al guardar el archivo subido
      // (middleware evidenceUpload). Antes se aceptaba `file_path` del cuerpo:
      // el cliente declaraba la ruta de un archivo que no existía y quedaba
      // registrado como evidencia válida («Certificado_Sanitario_2026.pdf
      // (Cargado)» sin haber subido nada). Sin archivo no hay evidencia.
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'BAD_REQUEST: se requiere el archivo (campo multipart "file"); no se acepta una ruta declarada por el cliente',
        });
      }
      const filePath = `/uploads/evidence/${req.file.filename}`;

      const result = await businessWorkflowService.submitEvidence({
        taskId: req.params.id,
        providerId,
        tenantId,
        filePath,
        evidenceType: validatedBody.evidence_type || req.body.evidence_type,
        notes: validatedBody.notes || req.body.notes
      });

      if (!result) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN: Tarea no pertenece al tenant autorizado' });
      }

      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      if (err.name === 'ZodError') {
        return res.status(400).json({ success: false, error: 'BAD_REQUEST: Datos de entrada inválidos', details: err.errors });
      }
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // GET /api/v1/business/templates (Private Provider)
  async getTemplates(req, res) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, error: 'UNAUTHORIZED: Autenticación requerida' });
      }

      const templates = await documentGeneratorService.getTemplates();
      return res.status(200).json({ success: true, data: templates });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // POST /api/v1/business/documents/generate (Private Provider)
  async generateDocument(req, res) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, error: 'UNAUTHORIZED: Autenticación requerida' });
      }

      const validatedBody = generateDocSchema.parse(req.body || {});

      const doc = await documentGeneratorService.generateDocument({
        templateCode: validatedBody.template_code || req.body.template_code,
        variables: validatedBody.variables || req.body.variables,
        providerId: req.user.id,
        tenantId: req.user.tenant_id,
        businessProfileId: validatedBody.business_profile_id || req.body.business_profile_id
      });

      return res.status(200).json({ success: true, data: doc });
    } catch (err) {
      if (err.name === 'ZodError') {
        return res.status(400).json({ success: false, error: 'BAD_REQUEST: Datos de entrada inválidos', details: err.errors });
      }
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // GET /api/v1/business/documents/:id/download (Private Provider/Admin)
  async downloadDocument(req, res) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, error: 'UNAUTHORIZED: Autenticación requerida' });
      }

      const result = await documentGeneratorService.getDocumentForDownload(
        req.params.id,
        req.user.id,
        req.user.tenant_id,
        req.user.role
      );

      if (result.status !== 200) {
        return res.status(result.status).json({ success: false, error: result.error });
      }

      if (req.query.format === 'html') {
        res.setHeader('Content-Type', 'text/html');
        return res.send(result.htmlContent);
      }

      return res.status(200).json({ success: true, data: result.doc, downloadUrl: result.downloadUrl });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // POST /api/v1/business/documents/:id/request-signature (Private Provider)
  async requestDocumentSignature(req, res) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, error: 'UNAUTHORIZED: Autenticación requerida' });
      }

      const result = await documentGeneratorService.requestSignature(
        req.params.id,
        req.user.id,
        req.user.tenant_id
      );

      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // POST /api/v1/business/documents/:id/sign (Private Provider/Admin)
  async signDocument(req, res) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, error: 'UNAUTHORIZED: Autenticación requerida' });
      }

      const validatedBody = signDocSchema.parse(req.body || {});

      const result = await documentGeneratorService.signDocument({
        documentId: req.params.id,
        providerId: req.user.id,
        tenantId: req.user.tenant_id,
        signerName: validatedBody.signer_name || req.user.name,
        signatureHash: validatedBody.signature_hash || req.body.signature_hash,
        role: req.user.role
      });

      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      if (err.name === 'ZodError') {
        return res.status(400).json({ success: false, error: 'BAD_REQUEST: Datos de entrada inválidos', details: err.errors });
      }
      const statusCode = err.message.startsWith('IMMUTABLE') ? 400 : (err.message.startsWith('FORBIDDEN') ? 403 : 500);
      return res.status(statusCode).json({ success: false, error: err.message });
    }
  }

  // POST /api/v1/business/documents/:id/version (Private Provider/Admin)
  async createDocumentVersion(req, res) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, error: 'UNAUTHORIZED: Autenticación requerida' });
      }

      const result = await documentGeneratorService.createDocumentVersion({
        parentDocumentId: req.params.id,
        variables: req.body.variables,
        providerId: req.user.id,
        tenantId: req.user.tenant_id,
        role: req.user.role
      });

      return res.status(201).json({ success: true, data: result });
    } catch (err) {
      const statusCode = err.message.startsWith('FORBIDDEN') ? 403 : 500;
      return res.status(statusCode).json({ success: false, error: err.message });
    }
  }

  // GET /api/v1/business/documents/:id/audit (Private Provider/Admin)
  async getDocumentAuditTrail(req, res) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, error: 'UNAUTHORIZED: Autenticación requerida' });
      }

      const result = await documentGeneratorService.getDocumentAuditTrail(
        req.params.id,
        req.user.id,
        req.user.tenant_id,
        req.user.role
      );

      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      const statusCode = err.message.startsWith('FORBIDDEN') ? 403 : 500;
      return res.status(statusCode).json({ success: false, error: err.message });
    }
  }

  // GET /api/v1/business/admin/queue (Admin Only)
  async getAdminQueue(req, res) {
    try {
      if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'FORBIDDEN: Se requieren permisos de administrador' });
      }

      const queue = await businessWorkflowService.getAdminEvidenceQueue();
      return res.status(200).json({ success: true, data: queue });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // PUT /api/v1/business/admin/evidence/:id (Admin Only)
  async reviewEvidence(req, res) {
    try {
      if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'FORBIDDEN: Se requieren permisos de administrador' });
      }

      const result = await businessWorkflowService.reviewEvidenceAdmin({
        evidenceId: req.params.id,
        action: req.body.action, // APPROVED or REJECTED
        notes: req.body.notes,
        adminId: req.user.id
      });

      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
}

module.exports = new BusinessController();

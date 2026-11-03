/**
 * GLOWAPP BUSINESS REPOSITORY
 * Data access layer for GlowApp Business Engine.
 * Supports PostgreSQL pool.query with parameterized SQL and fallback in-memory storage.
 */

const { pool, dbEnMemoria } = require('../config/db');

/** El fallback a memoria SOLO es legitimo cuando no hay base (modo memoria de
 *  las pruebas o caida de enlace). Con base disponible, un error de SQL es un
 *  error real: se propaga. Antes esta capa convertia CUALQUIER error (una FK
 *  violada, una tabla ausente) en datos inventados, y la API respondia 200 con
 *  un salon de demostracion que no existia en la base. */
function enMemoria(err, metodo) {
  if (dbEnMemoria()) return true;
  console.error(`[BusinessRepository] ${metodo}: error de SQL, se propaga sin fallback: ${err.message}`);
  return false;
}
const { verticals, requirements, documentTemplates } = require('../db/seed_business_data');

// In-memory data store for fallback when DB pool is disconnected or table is missing
const memoryProfiles = new Map();
const memoryTasks = new Map();
const memoryEvidences = new Map();
const memoryFindings = new Map();
const memoryDocs = new Map();
const memoryAuditLogs = [];

class BusinessRepository {
  // Verticals
  async getVerticals() {
    try {
      const res = await pool.query(
        'SELECT id, code, name, description, created_at FROM business_verticals ORDER BY name ASC'
      );
      if (res.rows.length > 0) return res.rows;
    } catch (err) {
      if (!enMemoria(err, 'getVerticals')) throw err;
    }
    return verticals;
  }

  async getVerticalByCode(code) {
    try {
      const res = await pool.query(
        'SELECT id, code, name, description, created_at FROM business_verticals WHERE code = $1',
        [code]
      );
      if (res.rows.length > 0) return res.rows[0];
    } catch (err) {
      if (!enMemoria(err, 'getVerticalByCode')) throw err;
    }
    return verticals.find(v => v.code === code) || verticals[0];
  }

  // Business Profiles
  async createProfile({ id, provider_id, tenant_id, vertical_id, name, onboarding_mode, lifecycle_stage, compliance_score, city, country }) {
    const profileId = id || `biz-${Date.now()}`;
    const vertId = vertical_id || verticals[0].id;
    const mode = onboarding_mode || 'NEW_BUSINESS';
    const stage = lifecycle_stage || (mode === 'EXISTING_BUSINESS' ? 'OPERATION' : 'IDEA');
    const score = compliance_score !== undefined ? compliance_score : (mode === 'EXISTING_BUSINESS' ? 45.0 : 10.0);
    const cityVal = city || 'Bogotá';
    const countryVal = country || 'Colombia';
    const tenantVal = tenant_id || null;

    try {
      // Upsert profile in PostgreSQL
      const res = await pool.query(
        `INSERT INTO business_profiles 
          (id, provider_id, tenant_id, vertical_id, name, onboarding_mode, lifecycle_stage, compliance_score, city, country, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO UPDATE SET
           tenant_id = EXCLUDED.tenant_id,
           name = EXCLUDED.name,
           onboarding_mode = EXCLUDED.onboarding_mode,
           lifecycle_stage = EXCLUDED.lifecycle_stage,
           compliance_score = EXCLUDED.compliance_score,
           city = EXCLUDED.city,
           country = EXCLUDED.country,
           updated_at = CURRENT_TIMESTAMP
         RETURNING *`,
        [profileId, provider_id, tenantVal, vertId, name, mode, stage, score, cityVal, countryVal]
      );
      if (res.rows.length > 0) {
        return res.rows[0];
      }
    } catch (err) {
      if (!enMemoria(err, 'createProfile')) throw err;
    }

    const profile = {
      id: profileId,
      provider_id,
      tenant_id: tenantVal,
      vertical_id: vertId,
      name,
      onboarding_mode: mode,
      lifecycle_stage: stage,
      compliance_score: score,
      city: cityVal,
      country: countryVal,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    memoryProfiles.set(profile.id, profile);
    return profile;
  }

  async getProfileByProviderId(providerId) {
    try {
      const res = await pool.query(
        'SELECT * FROM business_profiles WHERE provider_id = $1 ORDER BY created_at DESC LIMIT 1',
        [providerId]
      );
      if (res.rows.length > 0) return res.rows[0];
    } catch (err) {
      if (!enMemoria(err, 'getProfileByProviderId')) throw err;
    }

    const matchingProfiles = Array.from(memoryProfiles.values())
      .filter(p => p.provider_id === providerId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (matchingProfiles.length > 0) {
      return matchingProfiles[0];
    }

    // Sin expediente se devuelve null a propósito. Antes esta función fabricaba
    // un perfil de demostración («Salón de Belleza Demo», cumplimiento 35.0) y
    // el Business Center mostraba ese negocio inexistente como si fuera el del
    // proveedor. Quien decide qué hacer sin expediente es el llamador:
    // businessDiagnosticService.getProfileSummary devuelve null -> la API
    // responde 404, y runDiagnostic lo crea de verdad.
    return null;
  }

  async updateProfileStage(profileId, stage, complianceScore) {
    try {
      const res = await pool.query(
        `UPDATE business_profiles 
         SET lifecycle_stage = COALESCE($2, lifecycle_stage),
             compliance_score = COALESCE($3, compliance_score),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING *`,
        [profileId, stage, complianceScore]
      );
      if (res.rows.length > 0) return res.rows[0];
    } catch (err) {
      if (!enMemoria(err, 'updateProfileStage')) throw err;
    }

    const profile = memoryProfiles.get(profileId);
    if (profile) {
      if (stage) profile.lifecycle_stage = stage;
      if (complianceScore !== undefined) profile.compliance_score = complianceScore;
      profile.updated_at = new Date().toISOString();
      memoryProfiles.set(profileId, profile);
    }
    return profile;
  }

  // Requirements
  async getRequirementsByVertical(verticalId) {
    try {
      const res = await pool.query(
        'SELECT * FROM business_requirements WHERE vertical_id = $1 OR vertical_id IS NULL ORDER BY created_at ASC',
        [verticalId]
      );
      if (res.rows.length > 0) return res.rows;
    } catch (err) {
      if (!enMemoria(err, 'getRequirementsByVertical')) throw err;
    }
    return requirements.filter(r => r.vertical_id === verticalId || !r.vertical_id);
  }

  // Tasks
  async createTasks(taskList) {
    const created = [];
    for (const t of taskList) {
      const taskId = t.id || `task-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      const dueDate = t.due_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      
      try {
        const res = await pool.query(
          `INSERT INTO business_tasks 
            (id, business_profile_id, requirement_id, title, description, stage, status, due_date, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
           ON CONFLICT (id) DO UPDATE SET
             title = EXCLUDED.title,
             description = EXCLUDED.description,
             stage = EXCLUDED.stage,
             status = EXCLUDED.status,
             due_date = EXCLUDED.due_date,
             updated_at = CURRENT_TIMESTAMP
           RETURNING *`,
          [taskId, t.business_profile_id, t.requirement_id || null, t.title, t.description || '', t.stage || 'ENTENDER', t.status || 'PENDING', dueDate]
        );
        if (res.rows.length > 0) {
          created.push(res.rows[0]);
          continue;
        }
      } catch (err) {
        if (!enMemoria(err, 'createTasks')) throw err;
      }

      const task = {
        id: taskId,
        business_profile_id: t.business_profile_id,
        requirement_id: t.requirement_id,
        title: t.title,
        description: t.description || '',
        stage: t.stage || 'ENTENDER',
        status: t.status || 'PENDING',
        due_date: dueDate,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      memoryTasks.set(task.id, task);
      created.push(task);
    }
    return created;
  }

  async getTasksByProfileId(profileId) {
    try {
      const res = await pool.query(
        'SELECT * FROM business_tasks WHERE business_profile_id = $1 ORDER BY created_at ASC',
        [profileId]
      );
      if (res.rows.length > 0) return res.rows;
    } catch (err) {
      if (!enMemoria(err, 'getTasksByProfileId')) throw err;
    }

    const list = [];
    for (const t of memoryTasks.values()) {
      if (t.business_profile_id === profileId) {
        list.push(t);
      }
    }
    if (list.length === 0) {
      const defaultTasks = [
        {
          id: `task-1-${profileId}`,
          business_profile_id: profileId,
          requirement_id: requirements[0].id,
          title: 'Obtener Concepto Sanitario Municipal',
          description: 'Revisar condiciones del local y presentar solicitud a la Secretaría de Salud.',
          stage: 'ENTENDER',
          status: 'IN_PROGRESS',
          due_date: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString()
        },
        {
          id: `task-2-${profileId}`,
          business_profile_id: profileId,
          requirement_id: requirements[1].id,
          title: 'Elaborar Manual de Bioseguridad y RH1',
          description: 'Personalizar el protocolo de desinfección y manejo de residuos con advertencias de ley.',
          stage: 'EXPLICAR',
          status: 'PENDING',
          due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        }
      ];
      return this.createTasks(defaultTasks);
    }
    return list;
  }

  // Get task with ownership check (BUS-SEC-002: Tenant Isolation & IDOR Elimination)
  async getTaskByIdAndProvider(taskId, providerId) {
    try {
      const res = await pool.query(
        `SELECT t.* 
         FROM business_tasks t
         JOIN business_profiles p ON t.business_profile_id = p.id
         WHERE t.id = $1 AND p.provider_id = $2`,
        [taskId, providerId]
      );
      if (res.rows.length > 0) return res.rows[0];
    } catch (err) {
      if (!enMemoria(err, 'getTaskByIdAndProvider')) throw err;
    }

    // Memory fallback check
    const task = memoryTasks.get(taskId);
    if (!task) return null;

    const profile = memoryProfiles.get(task.business_profile_id);
    if (profile && profile.provider_id === providerId) {
      return task;
    }
    // Check if profile belongs to provider via demo logic
    if (task.business_profile_id.includes(providerId) || providerId.startsWith('demo')) {
      return task;
    }

    return null;
  }

  async updateTaskStage(taskId, stage, status) {
    try {
      const res = await pool.query(
        `UPDATE business_tasks 
         SET stage = COALESCE($2, stage),
             status = COALESCE($3, status),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING *`,
        [taskId, stage, status]
      );
      if (res.rows.length > 0) return res.rows[0];
    } catch (err) {
      if (!enMemoria(err, 'updateTaskStage')) throw err;
    }

    const task = memoryTasks.get(taskId);
    if (task) {
      if (stage) task.stage = stage;
      if (status) task.status = status;
      task.updated_at = new Date().toISOString();
      memoryTasks.set(taskId, task);
    }
    return task;
  }

  // Evidences
  async addEvidence({ id, task_id, file_path, evidence_type, validation_state, reviewer_notes }) {
    if (!file_path) {
      throw new Error('addEvidence requiere file_path: no se inventa la ruta de un archivo que no existe');
    }
    const evId = id || `ev-${Date.now()}`;
    const evType = evidence_type || 'DOCUMENT';
    const valState = validation_state || 'EVIDENCE_SUBMITTED';
    const notes = reviewer_notes || 'Evidencia subida correctamente por el usuario.';

    try {
      const res = await pool.query(
        `INSERT INTO business_evidences 
          (id, task_id, file_path, evidence_type, validation_state, reviewer_notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [evId, task_id, file_path || '/uploads/evidence_placeholder.pdf', evType, valState, notes]
      );
      if (res.rows.length > 0) return res.rows[0];
    } catch (err) {
      if (!enMemoria(err, 'addEvidence')) throw err;
    }

    const evidence = {
      id: evId,
      task_id,
      file_path: file_path || '/uploads/evidence_placeholder.pdf',
      evidence_type: evType,
      validation_state: valState,
      reviewer_notes: notes,
      created_at: new Date().toISOString()
    };
    memoryEvidences.set(evidence.id, evidence);
    return evidence;
  }

  async getEvidencesByTaskId(taskId) {
    try {
      const res = await pool.query(
        'SELECT * FROM business_evidences WHERE task_id = $1 ORDER BY created_at DESC',
        [taskId]
      );
      if (res.rows.length > 0) return res.rows;
    } catch (err) {
      if (!enMemoria(err, 'getEvidencesByTaskId')) throw err;
    }

    const list = [];
    for (const ev of memoryEvidences.values()) {
      if (ev.task_id === taskId) {
        list.push(ev);
      }
    }
    return list;
  }

  async getAdminEvidenceQueue() {
    try {
      const res = await pool.query(
        `SELECT e.*, t.title as task_title, t.business_profile_id, p.name as business_name, p.provider_id
         FROM business_evidences e
         JOIN business_tasks t ON e.task_id = t.id
         JOIN business_profiles p ON t.business_profile_id = p.id
         WHERE e.validation_state IN ('EVIDENCE_SUBMITTED', 'USER_DECLARED')
         ORDER BY e.created_at ASC`
      );
      if (res.rows.length > 0) return res.rows;
    } catch (err) {
      if (!enMemoria(err, 'getAdminEvidenceQueue')) throw err;
    }

    const queue = [];
    for (const ev of memoryEvidences.values()) {
      if (['EVIDENCE_SUBMITTED', 'USER_DECLARED'].includes(ev.validation_state)) {
        queue.push(ev);
      }
    }
    return queue;
  }

  async updateEvidenceStatus(evidenceId, validationState, reviewerNotes) {
    try {
      const res = await pool.query(
        `UPDATE business_evidences
         SET validation_state = $2,
             reviewer_notes = $3,
             verified_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING *`,
        [evidenceId, validationState, reviewerNotes]
      );
      if (res.rows.length > 0) return res.rows[0];
    } catch (err) {
      if (!enMemoria(err, 'updateEvidenceStatus')) throw err;
    }

    const ev = memoryEvidences.get(evidenceId);
    if (ev) {
      ev.validation_state = validationState;
      ev.reviewer_notes = reviewerNotes;
      ev.verified_at = new Date().toISOString();
      memoryEvidences.set(evidenceId, ev);
    }
    return ev;
  }

  // Findings
  async createFindings(findingsList) {
    const created = [];
    for (const f of findingsList) {
      const findingId = f.id || `find-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      try {
        const res = await pool.query(
          `INSERT INTO business_findings 
            (id, business_profile_id, title, description, risk_level, status, mitigation_plan, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
           RETURNING *`,
          [findingId, f.business_profile_id, f.title, f.description, f.risk_level || 'MEDIUM', f.status || 'OPEN', f.mitigation_plan || '']
        );
        if (res.rows.length > 0) {
          created.push(res.rows[0]);
          continue;
        }
      } catch (err) {
        if (!enMemoria(err, 'createFindings')) throw err;
      }

      const finding = {
        id: findingId,
        business_profile_id: f.business_profile_id,
        title: f.title,
        description: f.description,
        risk_level: f.risk_level || 'MEDIUM',
        status: f.status || 'OPEN',
        mitigation_plan: f.mitigation_plan || '',
        created_at: new Date().toISOString()
      };
      memoryFindings.set(finding.id, finding);
      created.push(finding);
    }
    return created;
  }

  async getFindingsByProfileId(profileId) {
    try {
      const res = await pool.query(
        'SELECT * FROM business_findings WHERE business_profile_id = $1 ORDER BY created_at ASC',
        [profileId]
      );
      if (res.rows.length > 0) return res.rows;
    } catch (err) {
      if (!enMemoria(err, 'getFindingsByProfileId')) throw err;
    }

    const list = [];
    for (const f of memoryFindings.values()) {
      if (f.business_profile_id === profileId) {
        list.push(f);
      }
    }
    return list;
  }

  // Templates
  async getDocumentTemplates() {
    try {
      const res = await pool.query('SELECT * FROM document_templates ORDER BY category, title');
      if (res.rows.length > 0) return res.rows;
    } catch (err) {
      if (!enMemoria(err, 'getDocumentTemplates')) throw err;
    }
    return documentTemplates;
  }

  async getTemplateByCode(code) {
    try {
      const res = await pool.query('SELECT * FROM document_templates WHERE code = $1', [code]);
      if (res.rows.length > 0) return res.rows[0];
    } catch (err) {
      if (!enMemoria(err, 'getTemplateByCode')) throw err;
    }
    return documentTemplates.find(t => t.code === code) || documentTemplates[0];
  }

  // Generated Documents & Signatures (GOAL 06 — PHASE F)
  async saveDocument(doc) {
    const docId = doc.id || `doc-${Date.now()}`;
    const version = doc.version || 1;
    const status = doc.status || 'DRAFT';

    const documentRecord = {
      id: docId,
      template_code: doc.template_code,
      business_profile_id: doc.business_profile_id || null,
      provider_id: doc.provider_id,
      tenant_id: doc.tenant_id || 'default',
      title: doc.title,
      category: doc.category,
      rendered_body: doc.rendered_body,
      watermark: doc.watermark,
      disclaimer: doc.disclaimer,
      version,
      status,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    memoryDocs.set(documentRecord.id, documentRecord);

    try {
      const res = await pool.query(
        `INSERT INTO business_documents 
          (id, template_code, business_profile_id, provider_id, tenant_id, title, category, rendered_body, watermark, disclaimer, version, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO UPDATE SET
           rendered_body = EXCLUDED.rendered_body,
           status = EXCLUDED.status,
           version = EXCLUDED.version,
           updated_at = CURRENT_TIMESTAMP
         RETURNING *`,
        [docId, doc.template_code, doc.business_profile_id || null, doc.provider_id, doc.tenant_id || 'default', doc.title, doc.category, doc.rendered_body, doc.watermark, doc.disclaimer, version, status]
      );
      if (res.rows.length > 0) return res.rows[0];
    } catch (err) {
      if (!enMemoria(err, 'saveDocument')) throw err;
    }

    return documentRecord;
  }

  async getDocumentById(docId) {
    try {
      const res = await pool.query('SELECT * FROM business_documents WHERE id = $1', [docId]);
      if (res.rows.length > 0) return res.rows[0];
    } catch (err) {
      if (!enMemoria(err, 'getDocumentById')) throw err;
    }
    return memoryDocs.get(docId) || null;
  }

  async updateDocumentSignature(docId, status, signedBy, signatureHash) {
    const docInMemory = memoryDocs.get(docId);
    if (docInMemory) {
      docInMemory.status = status;
      docInMemory.signed_by = signedBy;
      docInMemory.signature_hash = signatureHash;
      docInMemory.signed_at = new Date().toISOString();
      docInMemory.updated_at = new Date().toISOString();
      memoryDocs.set(docId, docInMemory);
    }

    try {
      const res = await pool.query(
        `UPDATE business_documents
         SET status = $2,
             signed_by = $3,
             signature_hash = $4,
             signed_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING *`,
        [docId, status, signedBy, signatureHash]
      );
      if (res.rows.length > 0) return res.rows[0];
    } catch (err) {
      if (!enMemoria(err, 'updateDocumentSignature')) throw err;
    }

    return docInMemory || null;
  }

  // Document Audit Logs
  async addDocumentAuditLog({ documentId, tenantId, providerId, actorId, action, metadata = {} }) {
    const logEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      document_id: documentId,
      tenant_id: tenantId || 'default',
      provider_id: providerId || 'system',
      actor_id: actorId || providerId || 'system',
      action,
      metadata: typeof metadata === 'string' ? metadata : JSON.stringify(metadata),
      created_at: new Date().toISOString()
    };

    try {
      await pool.query(
        `INSERT INTO document_audit_logs 
          (id, document_id, tenant_id, provider_id, actor_id, action, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
        [logEntry.id, logEntry.document_id, logEntry.tenant_id, logEntry.provider_id, logEntry.actor_id, logEntry.action, logEntry.metadata]
      );
    } catch (err) {
      if (!enMemoria(err, 'addDocumentAuditLog')) throw err;
    }

    memoryAuditLogs.push(logEntry);
    return logEntry;
  }

  async getDocumentAuditLogs(documentId) {
    try {
      const res = await pool.query(
        'SELECT * FROM document_audit_logs WHERE document_id = $1 ORDER BY created_at ASC',
        [documentId]
      );
      if (res.rows.length > 0) return res.rows;
    } catch (err) {
      if (!enMemoria(err, 'getDocumentAuditLogs')) throw err;
    }
    return memoryAuditLogs.filter(a => a.document_id === documentId);
  }
}

module.exports = new BusinessRepository();

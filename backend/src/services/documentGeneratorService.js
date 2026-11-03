/**
 * GLOWAPP DOCUMENT GENERATOR & SIGNATURE SERVICE
 * Renders templates with business variables, inserts legal disclaimers, handles document persistence, versioning, download authorization, and electronic signatures.
 */

const businessRepository = require('../repositories/businessRepository');
const crypto = require('crypto');

class DocumentGeneratorService {
  async getTemplates() {
    return businessRepository.getDocumentTemplates();
  }

  async generateDocument({ templateCode, variables, providerId, tenantId, businessProfileId }) {
    const template = await businessRepository.getTemplateByCode(templateCode || 'TPL_LABOR_CONTRACT_BEAUTY');
    
    let renderedBody = template.template_body;
    const vars = variables || {};

    // Replace {{variable}} tokens
    Object.keys(vars).forEach(key => {
      const regex = new RegExp(`{{${key}}}`, 'g');
      renderedBody = renderedBody.replace(regex, vars[key]);
    });

    // Replace any remaining unpopulated tokens with placeholder
    renderedBody = renderedBody.replace(/{{[a-zA-Z0-9_]+}}/g, '[________]');

    const docRecord = await businessRepository.saveDocument({
      template_code: template.code,
      business_profile_id: businessProfileId || null,
      provider_id: providerId || 'system-default',
      tenant_id: tenantId || 'tenant-default',
      title: template.title,
      category: template.category,
      rendered_body: renderedBody,
      watermark: 'BORRADOR DE TRABAJO - REQUIERE REVISIÓN LEGAL',
      disclaimer: template.disclaimer,
      version: 1,
      status: 'DRAFT'
    });

    // Audit Log: document_created
    await businessRepository.addDocumentAuditLog({
      documentId: docRecord.id,
      tenantId: docRecord.tenant_id,
      providerId: docRecord.provider_id,
      actorId: providerId || 'system',
      action: 'document_created',
      metadata: { templateCode: template.code, version: 1 }
    });

    return {
      documentId: docRecord.id,
      templateCode: template.code,
      title: template.title,
      category: template.category,
      renderedBody: docRecord.rendered_body,
      disclaimer: docRecord.disclaimer,
      version: docRecord.version,
      status: docRecord.status,
      generatedAt: docRecord.created_at,
      watermark: docRecord.watermark
    };
  }

  async createDocumentVersion({ parentDocumentId, variables, providerId, tenantId, role = 'provider' }) {
    const parentDoc = await businessRepository.getDocumentById(parentDocumentId);
    if (!parentDoc) throw new Error('Documento padre no encontrado');

    // Provider Isolation Check
    if (role !== 'admin' && parentDoc.provider_id !== providerId) {
      throw new Error('FORBIDDEN: No tienes autorizacion para versionar documentos de otro prestador');
    }

    const template = await businessRepository.getTemplateByCode(parentDoc.template_code);
    let renderedBody = template.template_body;
    const vars = variables || {};

    Object.keys(vars).forEach(key => {
      const regex = new RegExp(`{{${key}}}`, 'g');
      renderedBody = renderedBody.replace(regex, vars[key]);
    });
    renderedBody = renderedBody.replace(/{{[a-zA-Z0-9_]+}}/g, '[________]');

    const nextVersion = (parentDoc.version || 1) + 1;
    const newDocId = `doc-${Date.now()}`;

    const newDocRecord = await businessRepository.saveDocument({
      id: newDocId,
      template_code: parentDoc.template_code,
      business_profile_id: parentDoc.business_profile_id,
      provider_id: parentDoc.provider_id,
      tenant_id: parentDoc.tenant_id,
      title: `${parentDoc.title} (v${nextVersion})`,
      category: parentDoc.category,
      rendered_body: renderedBody,
      watermark: `DOCUMENTO OFICIAL v${nextVersion}`,
      disclaimer: parentDoc.disclaimer,
      version: nextVersion,
      status: 'DRAFT'
    });

    // Audit Log: version_created
    await businessRepository.addDocumentAuditLog({
      documentId: newDocRecord.id,
      tenantId: newDocRecord.tenant_id,
      providerId: newDocRecord.provider_id,
      actorId: providerId,
      action: 'version_created',
      metadata: { parentDocumentId, previousVersion: parentDoc.version, newVersion: nextVersion }
    });

    return {
      documentId: newDocRecord.id,
      parentDocumentId,
      version: newDocRecord.version,
      title: newDocRecord.title,
      status: newDocRecord.status,
      renderedBody: newDocRecord.rendered_body,
      createdAt: newDocRecord.created_at
    };
  }

  async getDocumentForDownload(documentId, providerId, tenantId, role = 'provider') {
    const doc = await businessRepository.getDocumentById(documentId);
    if (!doc) {
      return { status: 404, error: 'Documento no encontrado' };
    }

    // Provider-vs-Provider & Tenant Isolation Check (GAP 01 Fix)
    if (role !== 'admin') {
      if (doc.provider_id !== providerId) {
        return { status: 403, error: 'FORBIDDEN: No tienes autorizacion para descargar documentos de otro prestador' };
      }
      if (tenantId && doc.tenant_id !== tenantId) {
        return { status: 403, error: 'FORBIDDEN: No tienes autorizacion para descargar documentos de otro tenant' };
      }
    }

    // Audit Log: document_downloaded
    await businessRepository.addDocumentAuditLog({
      documentId: doc.id,
      tenantId: doc.tenant_id,
      providerId: doc.provider_id,
      actorId: providerId,
      action: 'document_downloaded',
      metadata: { role }
    });

    // Format downloadable document payload
    const formattedHtml = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>${doc.title}</title>
  <style>
    body { font-family: sans-serif; padding: 40px; color: #1e293b; line-height: 1.6; }
    .watermark { font-size: 10pt; color: #64748b; text-transform: uppercase; margin-bottom: 20px; font-weight: bold; border-bottom: 1px solid #cbd5e1; padding-bottom: 8px; }
    .title { font-size: 16pt; font-weight: bold; margin-bottom: 24px; color: #0f172a; }
    .content { white-space: pre-wrap; margin-bottom: 30px; font-size: 11pt; }
    .disclaimer { background-color: #f8fafc; border-left: 4px solid #e2e8f0; padding: 12px; font-size: 9pt; color: #475569; margin-top: 40px; }
    .signature-block { margin-top: 50px; border-top: 1px dashed #cbd5e1; padding-top: 15px; font-size: 10pt; }
  </style>
</head>
<body>
  <div class="watermark">${doc.watermark || 'DOCUMENTO OFICIAL GLOWAPP'} - VERSIÓN ${doc.version || 1} [ESTADO: ${doc.status}]</div>
  <div class="title">${doc.title}</div>
  <div class="content">${doc.rendered_body}</div>
  ${doc.signed_by ? `
  <div class="signature-block">
    <strong>FIRMADO ELECTRÓNICAMENTE POR:</strong> ${doc.signed_by}<br/>
    <strong>HASH DE FIRMA:</strong> <code>${doc.signature_hash}</code><br/>
    <strong>FECHA DE FIRMA:</strong> ${doc.signed_at}
  </div>` : ''}
  <div class="disclaimer">${doc.disclaimer}</div>
</body>
</html>
    `.trim();

    return {
      status: 200,
      doc,
      downloadUrl: `/api/v1/business/documents/${doc.id}/download`,
      htmlContent: formattedHtml
    };
  }

  async requestSignature(documentId, providerId, tenantId, role = 'provider') {
    const doc = await businessRepository.getDocumentById(documentId);
    if (!doc) throw new Error('Documento no encontrado');

    // Provider Isolation Check
    if (role !== 'admin' && doc.provider_id !== providerId) {
      throw new Error('FORBIDDEN: No tienes permisos sobre este documento de otro prestador');
    }

    if (doc.status === 'SIGNED') {
      throw new Error('IMMUTABLE: El documento ya ha sido firmado y no admite solicitudes de firma adicionales');
    }

    const updated = await businessRepository.updateDocumentSignature(documentId, 'PENDING_SIGNATURE', null, null);

    // Audit Log: signature_requested
    await businessRepository.addDocumentAuditLog({
      documentId: updated.id,
      tenantId: updated.tenant_id,
      providerId: updated.provider_id,
      actorId: providerId,
      action: 'signature_requested',
      metadata: { previousStatus: doc.status, newStatus: 'PENDING_SIGNATURE' }
    });

    return {
      documentId: updated.id,
      status: updated.status,
      message: 'Solicitud de firma registrada. Documento en estado PENDING_SIGNATURE.'
    };
  }

  async signDocument({ documentId, providerId, tenantId, signerName, signatureHash, role = 'provider' }) {
    const doc = await businessRepository.getDocumentById(documentId);
    if (!doc) throw new Error('Documento no encontrado');

    // Provider Isolation Check (GAP 01 Fix)
    if (role !== 'admin' && doc.provider_id !== providerId) {
      throw new Error('FORBIDDEN: No tienes permisos sobre este documento de otro prestador');
    }

    // Immutability Check (GAP 03 Fix)
    if (doc.status === 'SIGNED') {
      throw new Error('IMMUTABLE: El documento ya ha sido firmado y es inalterable');
    }

    const generatedHash = signatureHash || crypto.createHash('sha256').update(`${doc.id}-${signerName}-${Date.now()}`).digest('hex');

    const updated = await businessRepository.updateDocumentSignature(
      documentId,
      'SIGNED',
      signerName || `Prestador (${providerId})`,
      generatedHash
    );

    // Audit Log: document_signed
    await businessRepository.addDocumentAuditLog({
      documentId: updated.id,
      tenantId: updated.tenant_id,
      providerId: updated.provider_id,
      actorId: providerId,
      action: 'document_signed',
      metadata: { signerName: updated.signed_by, signatureHash: updated.signature_hash }
    });

    return {
      documentId: updated.id,
      status: updated.status,
      signedBy: updated.signed_by,
      signatureHash: updated.signature_hash,
      signedAt: updated.signed_at,
      message: 'Documento firmado electrónicamente exitosamente.'
    };
  }

  async getDocumentAuditTrail(documentId, providerId, tenantId, role = 'provider') {
    const doc = await businessRepository.getDocumentById(documentId);
    if (!doc) throw new Error('Documento no encontrado');

    if (role !== 'admin' && doc.provider_id !== providerId) {
      throw new Error('FORBIDDEN: No tienes permisos para ver la trazabilidad de este documento');
    }

    const auditLogs = await businessRepository.getDocumentAuditLogs(documentId);
    return {
      documentId: doc.id,
      title: doc.title,
      version: doc.version,
      status: doc.status,
      auditLogs
    };
  }
}

module.exports = new DocumentGeneratorService();

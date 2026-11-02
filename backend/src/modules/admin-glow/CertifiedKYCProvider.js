/**
 * Proveedor KYC Certificado para GlowApp
 * Integración con DataCrédito / Experian / MidData
 * Requiere contrato vigente con proveedor certificado
 */
const { pool } = require('../../config/db');
const crypto = require('crypto');

class CertifiedKYCProvider {
  constructor() {
    this.providerName = process.env.KYC_PROVIDER || 'datacredito';
    this.apiKey = process.env.KYC_API_KEY;
    this.apiEndpoint = process.env.KYC_API_ENDPOINT || 'https://api.datacredito.com.co/v1/verify';
    this.auditLogTable = 'kyc_audit_logs';
    
    if (!this.apiKey) {
      console.warn('[KYC] ADVERTENCIA: KYC_API_KEY no configurada. Requiere contrato con proveedor certificado.');
    }
  }

  /**
   * Validar documento con proveedor certificado
   * @param {string} documentType - Tipo de documento (CC, CE, NIT, PASAPORTE)
   * @param {string} documentNumber - Número de documento
   * @param {string} providerId - ID del prestador
   * @returns {Promise<{valid: boolean, providerResponse: object, auditId: string}>}
   */
  async verifyDocument(documentType, documentNumber, providerId) {
    if (!this.apiKey) {
      throw new Error('KYC_PROVIDER_NOT_CONFIGURED: Proveedor certificado no configurado. Requiere contrato con DataCrédito/Experian/MidData y KYC_API_KEY en variables de entorno.');
    }

    const auditId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    try {
      // Llamada real al proveedor certificado
      const response = await this._callCertifiedProvider(documentType, documentNumber);
      
      // Registrar evidencia KYC inmutable
      await this.logKYCEvidence(providerId, documentType, documentNumber, response, response.valid ? 'APROBADO' : 'RECHAZADO', auditId);

      return {
        valid: response.valid,
        providerResponse: response,
        auditId
      };
    } catch (error) {
      // Registrar error en auditoría
      await this.logKYCEvidence(providerId, documentType, documentNumber, { error: error.message }, 'ERROR', auditId);
      throw error;
    }
  }

  /**
   * Llamada HTTP al proveedor certificado (DataCrédito/Experian/MidData)
   * @private
   */
  async _callCertifiedProvider(documentType, documentNumber) {
    const axios = require('axios');
    
    const payload = {
      document_type: documentType,
      document_number: documentNumber,
      provider: this.providerName,
      timestamp: new Date().toISOString()
    };

    const response = await axios.post(this.apiEndpoint, payload, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'X-Provider': this.providerName
      },
      timeout: 10000
    });

    // Normalizar respuesta del proveedor
    return {
      valid: response.data.approved === true || response.data.status === 'APPROVED',
      provider: this.providerName,
      rawResponse: response.data,
      verifiedAt: new Date().toISOString(),
      score: response.data.score || null,
      riskLevel: response.data.risk_level || null
    };
  }

  /**
   * Registrar evidencia KYC inmutable para auditoría legal
   * Tabla: kyc_audit_logs
   * @param {string} providerId - ID del prestador
   * @param {string} documentType - Tipo de documento
   * @param {string} documentNumber - Número de documento (se hashea)
   * @param {object} providerResponse - Respuesta completa del proveedor
   * @param {string} result - APROBADO | RECHAZADO | ERROR
   * @param {string} auditId - UUID único de auditoría
   * @returns {Promise<string>} auditId
   */
  async logKYCEvidence(providerId, documentType, documentNumber, providerResponse, result, auditId) {
    const documentNumberHash = this._hashDocumentNumber(documentNumber);
    const providerResponseHash = crypto.createHash('sha256').update(JSON.stringify(providerResponse)).digest('hex');
    const auditHash = crypto.createHash('sha256').update(`${auditId}:${providerId}:${documentNumberHash}:${result}:${Date.now()}`).digest('hex');
    const timestamp = new Date().toISOString();

    const query = `
      INSERT INTO ${this.auditLogTable} (
        audit_id, provider_id, document_type, document_number_hash,
        provider_name, provider_response_hash, result, created_at, audit_hash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (audit_id) DO NOTHING;
    `;

    await pool.query(query, [
      auditId,
      providerId,
      documentType,
      documentNumberHash,
      this.providerName,
      providerResponseHash,
      result,
      timestamp,
      auditHash
    ]);

    return auditId;
  }

  /**
   * Hash seguro del número de documento (no almacenar en claro)
   * @private
   */
  _hashDocumentNumber(documentNumber) {
    if (!documentNumber) return null;
    return crypto.createHash('sha256').update(documentNumber.trim()).digest('hex');
  }

  /**
   * Obtener historial de auditoría KYC para un prestador
   * @param {string} providerId - ID del prestador
   * @returns {Promise<Array>} Registros de auditoría
   */
  async getKYCAuditHistory(providerId) {
    const query = `
      SELECT audit_id, document_type, provider_name, result, created_at, audit_hash
      FROM ${this.auditLogTable}
      WHERE provider_id = $1
      ORDER BY created_at DESC;
    `;
    const result = await pool.query(query, [providerId]);
    return result.rows;
  }

  /**
   * Verificar integridad de registro de auditoría
   * @param {string} auditId - ID de auditoría
   * @returns {Promise<boolean>} True si el hash coincide
   */
  async verifyAuditIntegrity(auditId) {
    const query = `SELECT * FROM ${this.auditLogTable} WHERE audit_id = $1;`;
    const result = await pool.query(query, [auditId]);
    
    if (result.rows.length === 0) return false;
    
    const row = result.rows[0];
    const expectedHash = crypto.createHash('sha256')
      .update(`${row.audit_id}:${row.provider_id}:${row.document_number_hash}:${row.result}:${new Date(row.created_at).getTime()}`)
      .digest('hex');
    
    return expectedHash === row.audit_hash;
  }
}

module.exports = { CertifiedKYCProvider };
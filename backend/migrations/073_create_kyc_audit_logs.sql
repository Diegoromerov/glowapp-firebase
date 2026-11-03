-- Migration 073: Create kyc_audit_logs table for legal retention of KYC evidence
-- Required for regulatory compliance: immutable audit trail of KYC verifications
-- Providers: DataCrédito / Experian / MidData (certified)

CREATE TABLE IF NOT EXISTS kyc_audit_logs (
    audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id VARCHAR(100) NOT NULL,
    document_type VARCHAR(20) NOT NULL, -- 'CC', 'CE', 'NIT', 'PASAPORTE', 'OTRO'
    document_number_hash CHAR(64) NOT NULL, -- SHA-256 hash, never store raw document number
    provider_name VARCHAR(50) NOT NULL, -- 'datacredito', 'experian', 'middata'
    provider_response_hash CHAR(64) NOT NULL, -- SHA-256 hash of full provider response
    result VARCHAR(20) NOT NULL, -- 'APROBADO', 'RECHAZADO', 'ERROR'
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    audit_hash CHAR(64) NOT NULL, -- SHA-256 integrity hash: audit_id:provider_id:document_number_hash:result:timestamp
    
    -- Constraints
    CONSTRAINT chk_kyc_result CHECK (result IN ('APROBADO', 'RECHAZADO', 'ERROR')),
    CONSTRAINT chk_document_type CHECK (document_type IN ('CC', 'CE', 'NIT', 'PASAPORTE', 'OTRO'))
);

-- Indexes for audit queries
CREATE INDEX IF NOT EXISTS idx_kyc_audit_provider_id ON kyc_audit_logs(provider_id);
CREATE INDEX IF NOT EXISTS idx_kyc_audit_created_at ON kyc_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kyc_audit_result ON kyc_audit_logs(result);
CREATE INDEX IF NOT EXISTS idx_kyc_audit_provider_name ON kyc_audit_logs(provider_name);

-- Immutable audit: prevent updates and deletes
CREATE OR REPLACE FUNCTION prevent_kyc_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'KYC audit logs are immutable - modifications not allowed for legal compliance';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_prevent_kyc_audit_update ON kyc_audit_logs;
CREATE TRIGGER trg_prevent_kyc_audit_update
    BEFORE UPDATE ON kyc_audit_logs
    FOR EACH ROW EXECUTE FUNCTION prevent_kyc_audit_modification();

DROP TRIGGER IF EXISTS trg_prevent_kyc_audit_delete ON kyc_audit_logs;
CREATE TRIGGER trg_prevent_kyc_audit_delete
    BEFORE DELETE ON kyc_audit_logs
    FOR EACH ROW EXECUTE FUNCTION prevent_kyc_audit_modification();

-- Grant read-only access to application role (adjust role name as needed)
-- GRANT SELECT ON kyc_audit_logs TO glowapp_app;
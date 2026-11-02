-- MIGRATION 063: PRIVACY BY DESIGN, STORAGE RETENTION & ARCO ANONYMIZATION
-- Complies with GDPR Article 25, Ley 1581, and Privacy by Design principles.

-- 1. PROCEDURE FOR ANONYMIZING BUSINESS PROFILES ON RIGHT TO ERASURE (ARCO)
CREATE OR REPLACE FUNCTION anonymize_business_profile(p_profile_id TEXT)
RETURNS VOID AS $$
BEGIN
  -- Anonymize PII in business_profiles
  UPDATE business_profiles
  SET name = 'NEGOCIO_ANONIMIZADO_' || SUBSTR(MD5(id), 1, 8),
      city = 'ANONIMIZADO',
      country = 'ANONIMIZADO',
      updated_at = CURRENT_TIMESTAMP
  WHERE id = p_profile_id;

  -- Purge draft documents associated with profile
  DELETE FROM business_documents
  WHERE business_profile_id = p_profile_id AND status = 'DRAFT';

  -- Anonymize signed document metadata while keeping cryptographic hash proof for statutory legal holds
  UPDATE business_documents
  SET signed_by = 'PRESTADOR_ANONIMIZADO'
  WHERE business_profile_id = p_profile_id AND status = 'SIGNED';
END;
$$ LANGUAGE plpgsql;

-- 2. PROCEDURE FOR AUTOMATED DRAFT STORAGE PURGE (GDPR Storage Limitation Principle)
CREATE OR REPLACE FUNCTION purge_abandoned_draft_documents(p_days_old INT DEFAULT 90)
RETURNS INT AS $$
DECLARE
  v_deleted_count INT;
BEGIN
  DELETE FROM business_documents
  WHERE status = 'DRAFT'
    AND created_at < NOW() - (p_days_old || ' days')::INTERVAL;
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql;

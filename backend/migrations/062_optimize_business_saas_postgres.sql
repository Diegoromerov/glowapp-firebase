-- MIGRATION 062: POSTGRESQL PERFORMANCE & SECURITY OPTIMIZATION FOR GLOWAPP SAAS ENGINE
-- Complies with postgresql and postgres-best-practices rules (Rule 42, 49, 72, 91, 108).

-- 1. FOREIGN KEY INDEXES (Rule 49: PostgreSQL does not auto-index FK columns)
CREATE INDEX IF NOT EXISTS idx_business_tasks_profile_id 
ON business_tasks(business_profile_id);

CREATE INDEX IF NOT EXISTS idx_business_evidences_task_id 
ON business_evidences(task_id);

CREATE INDEX IF NOT EXISTS idx_business_findings_profile_id 
ON business_findings(business_profile_id);

CREATE INDEX IF NOT EXISTS idx_business_documents_provider_tenant 
ON business_documents(provider_id, tenant_id);

CREATE INDEX IF NOT EXISTS idx_business_documents_profile_id 
ON business_documents(business_profile_id);

CREATE INDEX IF NOT EXISTS idx_document_audit_logs_doc_id 
ON document_audit_logs(document_id);

-- 2. PARTIAL INDEX FOR HOT ADMIN QUEUE (Rule 108: Hot Query Subset Indexing)
CREATE INDEX IF NOT EXISTS idx_business_evidences_admin_queue 
ON business_evidences (created_at ASC) 
WHERE validation_state IN ('EVIDENCE_SUBMITTED', 'USER_DECLARED');

-- 3. PARTIAL INDEX FOR OPEN TASKS AND FINDINGS
CREATE INDEX IF NOT EXISTS idx_business_tasks_active 
ON business_tasks(business_profile_id, stage) 
WHERE status IN ('IN_PROGRESS', 'PENDING');

CREATE INDEX IF NOT EXISTS idx_business_findings_open 
ON business_findings(business_profile_id, risk_level) 
WHERE status = 'OPEN';

-- 4. CONVERT AUDIT METADATA TO NATIVE JSONB & ADD GIN INDEX (Rule 72)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'document_audit_logs') THEN
    ALTER TABLE document_audit_logs 
      ALTER COLUMN metadata TYPE JSONB USING metadata::jsonb;
    
    CREATE INDEX IF NOT EXISTS idx_document_audit_logs_metadata_gin 
    ON document_audit_logs USING GIN (metadata);
  END IF;
END $$;

-- 5. ENABLE ROW LEVEL SECURITY (RLS) & POLICIES FOR SAAS TABLES (Rule 91)
DO $$
DECLARE
    tbl TEXT;
    saas_tables TEXT[] := ARRAY[
        'business_profiles',
        'business_tasks',
        'business_evidences',
        'business_findings',
        'business_documents',
        'document_audit_logs'
    ];
BEGIN
    FOREACH tbl IN ARRAY saas_tables LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = tbl) THEN
            IF NOT (SELECT relrowsecurity FROM pg_class WHERE relname = tbl) THEN
                EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY;', tbl);
            END IF;
            
            EXECUTE format(
                'DROP POLICY IF EXISTS tenant_isolation_%I ON %I;'
                || 'CREATE POLICY tenant_isolation_%I ON %I'
                || ' FOR ALL'
                || ' USING (tenant_id = current_setting(''app.tenant_id'', true) OR current_setting(''app.tenant_id'', true) IS NULL);',
                tbl, tbl, tbl, tbl
            );
        END IF;
    END LOOP;
END $$;

-- 6. RATING & COMPLIANCE SCORE OPTIMIZATION (postgres-best-practices Priority 1 & 4)
CREATE INDEX IF NOT EXISTS idx_business_tasks_profile_status_score
ON business_tasks (business_profile_id, status)
INCLUDE (id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'business_profiles') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.constraint_column_usage 
      WHERE table_name = 'business_profiles' AND constraint_name = 'check_compliance_score_range'
    ) THEN
      ALTER TABLE business_profiles 
        ADD CONSTRAINT check_compliance_score_range 
        CHECK (compliance_score >= 0.00 AND compliance_score <= 100.00);
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION calculate_glowapp_business_score(p_profile_id TEXT)
RETURNS NUMERIC AS $$
DECLARE
    v_task_score NUMERIC := 0;
    v_finding_penalty NUMERIC := 0;
    v_final_score NUMERIC := 0;
BEGIN
    SELECT COALESCE(ROUND((COUNT(CASE WHEN status = 'VERIFIED' THEN 1 END)::numeric / GREATEST(COUNT(*), 1)) * 80, 2), 0)
    INTO v_task_score
    FROM business_tasks
    WHERE business_profile_id = p_profile_id;

    SELECT COALESCE(COUNT(CASE WHEN status = 'OPEN' AND risk_level = 'HIGH' THEN 1 END) * 5.0, 0)
    INTO v_finding_penalty
    FROM business_findings
    WHERE business_profile_id = p_profile_id;

    v_final_score := GREATEST(0.00, LEAST(100.00, (v_task_score + 20.00) - v_finding_penalty));
    RETURN v_final_score;
END;
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;

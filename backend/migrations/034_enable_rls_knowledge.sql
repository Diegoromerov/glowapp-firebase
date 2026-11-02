-- Migration 034: Enable RLS on beauty_knowledge_embeddings for D-004
-- Enable row-level security
ALTER TABLE beauty_knowledge_embeddings ENABLE ROW LEVEL SECURITY;

-- Create policy for tenant isolation: allow access to GLOBAL (tenant_id IS NULL) or TENANT-SCOPED of current tenant
CREATE POLICY knowledge_tenant_isolation ON beauty_knowledge_embeddings
    FOR SELECT
    USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id')::int);

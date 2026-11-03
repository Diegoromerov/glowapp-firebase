-- Migration: 031_aura_pgvector_and_knowledge_table.sql
-- Description: Creates beauty_knowledge_embeddings table for RAG beauty search with multi-tenant and retention support
-- Depends on: 030_enable_pgvector.sql (creates pgvector extension)

CREATE TABLE IF NOT EXISTS beauty_knowledge_embeddings (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    embedding vector(768),
    tenant_id INTEGER REFERENCES tenants(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE
);

-- La tabla puede venir de una versión anterior sin las columnas de retención:
-- CREATE TABLE IF NOT EXISTS no las añade cuando la tabla ya existe, y los
-- índices de abajo fallarían con «column "deleted_at" does not exist».
-- Se añaden de forma idempotente antes de usarlas.
ALTER TABLE beauty_knowledge_embeddings ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE beauty_knowledge_embeddings ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_beauty_knowledge_category ON beauty_knowledge_embeddings(category);
CREATE INDEX IF NOT EXISTS idx_beauty_knowledge_tenant ON beauty_knowledge_embeddings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_beauty_knowledge_deleted ON beauty_knowledge_embeddings(deleted_at);
CREATE INDEX IF NOT EXISTS idx_beauty_knowledge_expires ON beauty_knowledge_embeddings(expires_at);
-- Composite index for retention worker efficiency
CREATE INDEX IF NOT EXISTS idx_beauty_knowledge_tenant_deleted_expires ON beauty_knowledge_embeddings(tenant_id, deleted_at, expires_at);
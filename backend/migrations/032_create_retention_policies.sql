-- Migration 032: Create retention_policies table for D-004
CREATE TABLE IF NOT EXISTS retention_policies (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(100),
    scope VARCHAR(20), -- 'GLOBAL', 'TENANT', or NULL (both)
    tenant_id INTEGER REFERENCES tenants(id),
    period INTEGER NOT NULL,
    unit VARCHAR(10) NOT NULL, -- 'days', 'months', 'years'
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

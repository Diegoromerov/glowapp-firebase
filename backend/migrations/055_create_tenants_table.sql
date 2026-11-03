-- D-001 Implementation: Create tenants table with default tenant
-- This migration creates the tenants table and inserts a default tenant for existing data

-- Create tenants table
CREATE TABLE IF NOT EXISTS tenants (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert a default tenant for existing data
-- This ensures that existing rows can have a valid tenant_id foreign key
INSERT INTO tenants (id, name, slug, created_at, updated_at)
VALUES (1, 'Default Tenant', 'default', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
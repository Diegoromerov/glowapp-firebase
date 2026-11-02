-- GLOWAPP MEMBERSHIP FOUNDATION MIGRATION (013_memberships.sql)
-- Additive, non-destructive schema extension for SaaS Membership & Active Context

CREATE TABLE IF NOT EXISTS memberships (
  id VARCHAR(36) PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  business_profile_id VARCHAR(36) NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('OWNER', 'ADMIN', 'MANAGER', 'MEMBER', 'VIEWER')),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'REVOKED')),
  invited_at TIMESTAMP WITH TIME ZONE,
  accepted_at TIMESTAMP WITH TIME ZONE,
  created_by_user_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_user_business_profile UNIQUE (user_id, business_profile_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_business_profile ON memberships(business_profile_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user_status ON memberships(user_id, status);

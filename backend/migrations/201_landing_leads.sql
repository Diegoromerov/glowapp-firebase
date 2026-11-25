-- Landing comercial: datos separados del dominio transaccional.
CREATE TABLE IF NOT EXISTS landing_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL CHECK (role IN ('client', 'professional', 'salon')),
  name TEXT NOT NULL,
  business_name TEXT,
  contact_type TEXT NOT NULL CHECK (contact_type IN ('email', 'whatsapp')),
  contact_normalized TEXT NOT NULL,
  city TEXT NOT NULL,
  neighborhood TEXT,
  referral_code TEXT,
  consent BOOLEAN NOT NULL CHECK (consent IS TRUE),
  consent_text_version TEXT NOT NULL,
  consent_at TIMESTAMPTZ NOT NULL,
  utm JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT landing_leads_role_contact_unique UNIQUE (role, contact_normalized)
);
ALTER TABLE landing_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE landing_leads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS landing_leads_system_insert ON landing_leads;
CREATE POLICY landing_leads_system_insert ON landing_leads FOR INSERT TO app_system WITH CHECK (true);
GRANT INSERT ON landing_leads TO app_system;

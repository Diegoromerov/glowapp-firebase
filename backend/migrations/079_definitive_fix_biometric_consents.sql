-- Migration 079: Definitive fix for biometric_consents schema
-- Handles the case where 026 renamed columns AND 037 added them back
-- This migration is idempotent and handles all conflict scenarios

BEGIN;

-- 1. CONSENT_TYPE / VERSION CONFLICT
-- If both exist: copy version -> consent_type, drop version
-- If only version exists: rename to consent_type
-- If only consent_type exists: keep it
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'biometric_consents' AND column_name = 'version')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'biometric_consents' AND column_name = 'consent_type') THEN
        UPDATE biometric_consents SET consent_type = version WHERE consent_type IS NULL AND version IS NOT NULL;
        ALTER TABLE biometric_consents DROP COLUMN version;
        RAISE NOTICE 'Dropped legacy column "version", data copied to "consent_type"';
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'biometric_consents' AND column_name = 'version')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'biometric_consents' AND column_name = 'consent_type') THEN
        ALTER TABLE biometric_consents RENAME COLUMN version TO consent_type;
        RAISE NOTICE 'Renamed "version" to "consent_type"';
    END IF;
END $$;

-- 2. IP_ADDRESS / IP CONFLICT
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'biometric_consents' AND column_name = 'ip')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'biometric_consents' AND column_name = 'ip_address') THEN
        BEGIN
            UPDATE biometric_consents SET ip_address = NULLIF(ip, '')::inet WHERE ip_address IS NULL AND ip IS NOT NULL AND ip ~ '^[0-9a-fA-F:\.]+$';
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
        ALTER TABLE biometric_consents DROP COLUMN ip;
        RAISE NOTICE 'Dropped legacy column "ip", data copied to "ip_address"';
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'biometric_consents' AND column_name = 'ip')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'biometric_consents' AND column_name = 'ip_address') THEN
        ALTER TABLE biometric_consents RENAME COLUMN ip TO ip_address;
        RAISE NOTICE 'Renamed "ip" to "ip_address"';
    END IF;
END $$;

-- 3. USER_AGENT / DEVICE_INFO CONFLICT
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'biometric_consents' AND column_name = 'device_info')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'biometric_consents' AND column_name = 'user_agent') THEN
        UPDATE biometric_consents SET user_agent = device_info WHERE user_agent IS NULL AND device_info IS NOT NULL;
        ALTER TABLE biometric_consents DROP COLUMN device_info;
        RAISE NOTICE 'Dropped legacy column "device_info", data copied to "user_agent"';
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'biometric_consents' AND column_name = 'device_info')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'biometric_consents' AND column_name = 'user_agent') THEN
        ALTER TABLE biometric_consents RENAME COLUMN device_info TO user_agent;
        RAISE NOTICE 'Renamed "device_info" to "user_agent"';
    END IF;
END $$;

-- 4. CREATED_AT / ACCEPTED_AT CONFLICT
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'biometric_consents' AND column_name = 'accepted_at')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'biometric_consents' AND column_name = 'created_at') THEN
        UPDATE biometric_consents SET created_at = accepted_at WHERE created_at IS NULL AND accepted_at IS NOT NULL;
        ALTER TABLE biometric_consents DROP COLUMN accepted_at;
        RAISE NOTICE 'Dropped legacy column "accepted_at", data copied to "created_at"';
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'biometric_consents' AND column_name = 'accepted_at')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'biometric_consents' AND column_name = 'created_at') THEN
        ALTER TABLE biometric_consents RENAME COLUMN accepted_at TO created_at;
        RAISE NOTICE 'Renamed "accepted_at" to "created_at"';
    END IF;
END $$;

-- 4.5. ACTIVE COLUMN REMOVAL
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'biometric_consents' AND column_name = 'active') THEN
        ALTER TABLE biometric_consents DROP COLUMN active;
        RAISE NOTICE 'Dropped legacy column "active"';
    END IF;
END $$;

-- 5. ENSURE ALL REQUIRED COLUMNS EXIST (code expectations from 020/021/037)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'biometric_consents' AND column_name = 'granted') THEN
        ALTER TABLE biometric_consents ADD COLUMN granted BOOLEAN DEFAULT FALSE;
        RAISE NOTICE 'Added column "granted"';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'biometric_consents' AND column_name = 'granted_at') THEN
        ALTER TABLE biometric_consents ADD COLUMN granted_at TIMESTAMP;
        RAISE NOTICE 'Added column "granted_at"';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'biometric_consents' AND column_name = 'revoked_at') THEN
        ALTER TABLE biometric_consents ADD COLUMN revoked_at TIMESTAMP;
        RAISE NOTICE 'Added column "revoked_at"';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'biometric_consents' AND column_name = 'purpose') THEN
        ALTER TABLE biometric_consents ADD COLUMN purpose TEXT;
        RAISE NOTICE 'Added column "purpose"';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'biometric_consents' AND column_name = 'version_terms') THEN
        ALTER TABLE biometric_consents ADD COLUMN version_terms VARCHAR(20) DEFAULT '1.0';
        RAISE NOTICE 'Added column "version_terms"';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'biometric_consents' AND column_name = 'updated_at') THEN
        ALTER TABLE biometric_consents ADD COLUMN updated_at TIMESTAMP DEFAULT NOW();
        RAISE NOTICE 'Added column "updated_at"';
    END IF;
    -- Ensure consent_type exists (may have been created by step 1)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'biometric_consents' AND column_name = 'consent_type') THEN
        ALTER TABLE biometric_consents ADD COLUMN consent_type VARCHAR(50);
        RAISE NOTICE 'Added column "consent_type"';
    END IF;
END $$;

-- 6. ENSURE UNIQUE CONSTRAINT FOR ON CONFLICT (user_id, consent_type, version_terms)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'biometric_consents_user_consent_version_key'
    ) THEN
        ALTER TABLE biometric_consents
            ADD CONSTRAINT biometric_consents_user_consent_version_key
            UNIQUE (user_id, consent_type, version_terms);
        RAISE NOTICE 'Created UNIQUE constraint (user_id, consent_type, version_terms)';
    END IF;
END $$;

-- 7. DROP LEGACY PARTIAL INDEX FROM 026 (uses 'active' column not used by code)
DROP INDEX IF EXISTS unique_active_consent;

-- 8. CREATE PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_consents_user 
ON biometric_consents (user_id, consent_type, granted);

CREATE INDEX IF NOT EXISTS idx_consents_audit 
ON biometric_consents (granted_at, revoked_at);

-- 9. ENSURE BIOMETRIC_ACCESS_LOG TABLE EXISTS AND HAS ALL REQUIRED COLUMNS
CREATE TABLE IF NOT EXISTS biometric_access_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  accessed_by VARCHAR(50),
  access_type VARCHAR(50),
  consent_id UUID,
  ip_address INET,
  accessed_at TIMESTAMP DEFAULT NOW(),
  details JSONB
);

ALTER TABLE biometric_access_log ADD COLUMN IF NOT EXISTS accessed_by VARCHAR(50);
ALTER TABLE biometric_access_log ADD COLUMN IF NOT EXISTS access_type VARCHAR(50);
ALTER TABLE biometric_access_log ADD COLUMN IF NOT EXISTS consent_id UUID;
ALTER TABLE biometric_access_log ADD COLUMN IF NOT EXISTS details JSONB;

CREATE INDEX IF NOT EXISTS idx_access_log_user 
ON biometric_access_log (user_id, accessed_at);

-- 10. TRIGGER FOR UPDATED_AT
CREATE OR REPLACE FUNCTION update_consent_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_consent_timestamp ON biometric_consents;
CREATE TRIGGER trigger_update_consent_timestamp
  BEFORE UPDATE ON biometric_consents
  FOR EACH ROW
  EXECUTE FUNCTION update_consent_timestamp();

-- 11. VERIFICATION - FAIL IF SCHEMA NOT CORRECT
DO $$
DECLARE
    cols text[];
    expected_cols text[] := ARRAY['id','user_id','consent_type','granted','granted_at','revoked_at','purpose','ip_address','user_agent','version_terms','created_at','updated_at'];
    missing text[];
    c text;
    legacy_cols text[] := ARRAY['version','ip','device_info','accepted_at','active'];
    found_legacy text[];
BEGIN
    SELECT array_agg(column_name) INTO cols
    FROM information_schema.columns
    WHERE table_name = 'biometric_consents';
    
    FOREACH c IN ARRAY expected_cols LOOP
        IF c NOT IN (SELECT unnest(cols)) THEN
            missing := array_append(missing, c);
        END IF;
    END LOOP;
    
    IF array_length(missing, 1) > 0 THEN
        RAISE EXCEPTION 'FAIL: Faltan columnas en biometric_consents: %', missing;
    ELSE
        RAISE NOTICE '✅ Todas las columnas esperadas existen en biometric_consents';
    END IF;
    
    -- Check constraint
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'biometric_consents_user_consent_version_key'
    ) THEN
        RAISE NOTICE '✅ Constraint UNIQUE (user_id, consent_type, version_terms) existe';
    ELSE
        RAISE EXCEPTION 'FAIL: Falta constraint UNIQUE';
    END IF;
    
    -- Check no legacy columns remain
    FOREACH c IN ARRAY legacy_cols LOOP
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'biometric_consents' AND column_name = c) THEN
            found_legacy := array_append(found_legacy, c);
        END IF;
    END LOOP;
    
    IF array_length(found_legacy, 1) > 0 THEN
        RAISE EXCEPTION 'FAIL: Columnas legacy aún existen: %', found_legacy;
    ELSE
        RAISE NOTICE '✅ No quedan columnas legacy (version, ip, device_info, accepted_at, active)';
    END IF;
    
    -- Check access log table
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'biometric_access_log'
    ) THEN
        RAISE NOTICE '✅ Tabla biometric_access_log existe';
    ELSE
        RAISE EXCEPTION 'FAIL: Falta tabla biometric_access_log';
    END IF;
    
    RAISE NOTICE '=== MIGRACIÓN 079 COMPLETADA - Schema alineado con código ===';
END $$;

COMMIT;
-- =========================================================================
-- Two-Sided Loyalty and Anti-Circumvention System Migration
-- Target Database: PostgreSQL 15 + PostGIS 3.3
-- =========================================================================

-- 1. Extensions (for multi-column spatial indexing support if needed)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 2. Alter existing tables to add necessary tracking fields
ALTER TABLE bookings 
  ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(20) CHECK (cancelled_by IN ('client', 'provider', 'system')),
  ADD COLUMN IF NOT EXISTS provider_faulted_cancellation BOOLEAN DEFAULT FALSE;

ALTER TABLE perfiles_prestador 
  ADD COLUMN IF NOT EXISTS is_avant_garde_elite BOOLEAN DEFAULT FALSE;

-- 3. Create User Loyalty and Virtual Wallet Tables
CREATE TABLE IF NOT EXISTS user_loyalty (
  user_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  tier VARCHAR(30) DEFAULT 'Base Complexion' NOT NULL 
    CHECK (tier IN ('Base Complexion', 'Glow Effect', 'Porcelain Radiance')),
  brillo_points NUMERIC(10,2) DEFAULT 0.00 NOT NULL CHECK (brillo_points >= 0),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_loyalty_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  amount NUMERIC(10,2) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Create Provider Loyalty and Penalty Tables
CREATE TABLE IF NOT EXISTS provider_loyalty (
  provider_id INTEGER PRIMARY KEY REFERENCES perfiles_prestador(id) ON DELETE CASCADE,
  tier VARCHAR(30) DEFAULT 'Creative Edge' NOT NULL 
    CHECK (tier IN ('Creative Edge', 'Visage Pro', 'Avant-Garde Elite')),
  lock_until TIMESTAMPTZ, -- For unappealable 60-day demotion lock
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Create Anti-Circumvention / Fraud Flags Table
CREATE TABLE IF NOT EXISTS fraud_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID UNIQUE NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  provider_id INTEGER NOT NULL REFERENCES perfiles_prestador(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Spatial Indices
-- Drop existing gist index if exists to avoid conflicts, then recreate optimized partial spatial indices
DROP INDEX IF EXISTS idx_perfiles_prestador_ubicacion;

-- A. Spatial index for all active and verified providers
CREATE INDEX IF NOT EXISTS idx_providers_spatial_active ON perfiles_prestador USING GIST (ubicacion)
WHERE is_active = true AND estatus_verificacion = 'APROBADO';

-- B. Specialized partial index for Avant-Garde Elite priority lookup
CREATE INDEX IF NOT EXISTS idx_providers_spatial_elite ON perfiles_prestador USING GIST (ubicacion)
WHERE is_active = true AND estatus_verificacion = 'APROBADO' AND is_avant_garde_elite = true;

-- 7. Split de la reserva: comisión única desde `platform_config` (D-GL-019/D-GL-023)
--
-- Esta función se redefine en CADA ARRANQUE de la aplicación, porque `index.js`
-- ejecuta este archivo. Antes fijaba 12% de comisión + 8% de impuestos: cualquier
-- despliegue revertía en silencio la migración 096 y devolvía producción al split
-- viejo. Si se vuelve a tocar, tiene que seguir leyendo la configuración.
CREATE OR REPLACE FUNCTION calc_booking_split()
RETURNS TRIGGER AS $$
DECLARE
  comm_rate NUMERIC(5,2);
BEGIN
  SELECT COALESCE(NULLIF(value, '')::NUMERIC, 20)
    INTO comm_rate
    FROM platform_config
   WHERE key = 'comision_plataforma_pct';

  -- Una configuración corrupta no puede vaciar el pago del prestador.
  IF comm_rate IS NULL OR comm_rate < 0 OR comm_rate > 50 THEN
    comm_rate := 20;
  END IF;

  NEW.comision_plataforma := ROUND(NEW.valor_bruto * (comm_rate / 100.0), 2);
  NEW.impuestos_estado    := 0;
  NEW.pago_neto_prestador := NEW.valor_bruto - NEW.comision_plataforma;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate trigger if exists
DROP TRIGGER IF EXISTS before_booking_insert_update ON bookings;
CREATE TRIGGER before_booking_insert_update
BEFORE INSERT OR UPDATE OF valor_bruto ON bookings
FOR EACH ROW EXECUTE FUNCTION calc_booking_split();

-- 8. Trigger to Automatically Synchronize Elite Tier Flag to perfiles_prestador for Spatial Indexing
CREATE OR REPLACE FUNCTION sync_provider_elite_flag()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE perfiles_prestador
  SET is_avant_garde_elite = (NEW.tier = 'Avant-Garde Elite')
  WHERE id = NEW.provider_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_provider_elite_flag ON provider_loyalty;
CREATE TRIGGER trg_sync_provider_elite_flag
AFTER INSERT OR UPDATE OF tier ON provider_loyalty
FOR EACH ROW EXECUTE FUNCTION sync_provider_elite_flag();

-- 9. Trigger to Process Client Cash-Back (Path of Radiance: 5% Brillo Points)
CREATE OR REPLACE FUNCTION process_client_loyalty_reward()
RETURNS TRIGGER AS $$
DECLARE
  c_tier VARCHAR(30);
  reward_points NUMERIC(10,2);
BEGIN
  -- Triggered on transition of booking status to COMPLETADA and payment_status to 'paid'
  IF NEW.estado = 'COMPLETADA' AND NEW.payment_status = 'paid' 
     AND (OLD.estado IS NULL OR OLD.estado != 'COMPLETADA' OR OLD.payment_status != 'paid') THEN
    
    -- Get current client tier
    SELECT tier INTO c_tier FROM user_loyalty WHERE user_id = NEW.client_id;
    
    -- Tiers 'Glow Effect' (Tier 2) and 'Porcelain Radiance' (Tier 3) earn 5% cash-back in Brillo Points
    IF c_tier IN ('Glow Effect', 'Porcelain Radiance') THEN
      reward_points := ROUND(NEW.valor_bruto * 0.05, 2);
      
      IF reward_points > 0 THEN
        -- Insert ledger record
        INSERT INTO user_loyalty_ledger (user_id, booking_id, amount, description)
        VALUES (NEW.client_id, NEW.id, reward_points, 'Cash-back de 5% por cita finalizada en ' || c_tier);

        -- Upsert user wallet balance
        INSERT INTO user_loyalty (user_id, tier, brillo_points, updated_at)
        VALUES (NEW.client_id, 'Base Complexion', reward_points, NOW())
        ON CONFLICT (user_id) DO UPDATE
        SET brillo_points = user_loyalty.brillo_points + reward_points,
            updated_at = NOW();
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_client_loyalty_reward ON bookings;
CREATE TRIGGER trg_client_loyalty_reward
AFTER UPDATE OF estado, payment_status ON bookings
FOR EACH ROW EXECUTE FUNCTION process_client_loyalty_reward();

-- 10. Trigger to Detect Circumvention / Platform Leakage
-- Automatically flag if a booking is cancelled within 30 minutes after an active in-app chat message exchange.
CREATE OR REPLACE FUNCTION detect_circumvention_on_cancellation()
RETURNS TRIGGER AS $$
DECLARE
  chat_exists BOOLEAN;
BEGIN
  IF NEW.estado = 'CANCELADA' AND OLD.estado IN ('CONFIRMADA', 'PENDIENTE_PAGO') THEN
    -- Check if there was any message sent in the preceding 30 minutes between these users
    SELECT EXISTS (
      SELECT 1 FROM messages
      WHERE (
        (sender_id = NEW.client_id AND receiver_id = NEW.provider_id)
        OR 
        (sender_id = NEW.provider_id AND receiver_id = NEW.client_id)
      )
      AND created_at >= NOW() - INTERVAL '30 minutes'
      AND created_at <= NOW()
    ) INTO chat_exists;

    IF chat_exists THEN
      INSERT INTO fraud_flags (booking_id, client_id, provider_id, created_at)
      VALUES (NEW.id, NEW.client_id, NEW.provider_id, NOW())
      ON CONFLICT (booking_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_detect_circumvention ON bookings;
CREATE TRIGGER trg_detect_circumvention
AFTER UPDATE OF estado ON bookings
FOR EACH ROW EXECUTE FUNCTION detect_circumvention_on_cancellation();

-- 11. Trigger to Enforce Penalty on Accumulated Fraud Flags
-- 3 active fraud flags in a calendar month results in demotion and 60-day lockout
CREATE OR REPLACE FUNCTION apply_provider_fraud_penalty()
RETURNS TRIGGER AS $$
DECLARE
  flag_count INTEGER;
BEGIN
  -- Count active fraud flags for this provider in the current calendar month
  SELECT COUNT(*) INTO flag_count
  FROM fraud_flags
  WHERE provider_id = NEW.provider_id
    AND is_active = TRUE
    AND created_at >= date_trunc('month', NOW())
    AND created_at < date_trunc('month', NOW()) + INTERVAL '1 month';

  IF flag_count >= 3 THEN
    -- Force tier demotion to Creative Edge and lock for 60 days
    INSERT INTO provider_loyalty (provider_id, tier, lock_until, updated_at)
    VALUES (NEW.provider_id, 'Creative Edge', NOW() + INTERVAL '60 days', NOW())
    ON CONFLICT (provider_id) DO UPDATE
    SET tier = 'Creative Edge',
        lock_until = NOW() + INTERVAL '60 days',
        updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_apply_fraud_penalty ON fraud_flags;
CREATE TRIGGER trg_apply_fraud_penalty
AFTER INSERT ON fraud_flags
FOR EACH ROW EXECUTE FUNCTION apply_provider_fraud_penalty();

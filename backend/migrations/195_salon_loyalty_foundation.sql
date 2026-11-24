-- Fase 6: fidelización independiente y configurable por salón.
-- No lee, migra ni modifica points_lots / points_movements de GlowApp global.
BEGIN;

CREATE TABLE IF NOT EXISTS salon_loyalty_programs (
  business_profile_id VARCHAR(36) NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
  salon_id INTEGER NOT NULL,
  points_per_completed_booking INTEGER NOT NULL DEFAULT 0 CHECK (points_per_completed_booking >= 0),
  points_per_1000_cop INTEGER NOT NULL DEFAULT 0 CHECK (points_per_1000_cop >= 0),
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (business_profile_id, salon_id),
  CONSTRAINT salon_loyalty_program_salon_scope
    FOREIGN KEY (salon_id, business_profile_id)
    REFERENCES salones(id, business_profile_id) ON DELETE CASCADE,
  CONSTRAINT salon_loyalty_program_has_rule
    CHECK (NOT is_enabled OR points_per_completed_booking > 0 OR points_per_1000_cop > 0)
);

CREATE TABLE IF NOT EXISTS salon_loyalty_program_audit (
  id BIGSERIAL PRIMARY KEY,
  business_profile_id VARCHAR(36) NOT NULL,
  salon_id INTEGER NOT NULL,
  points_per_completed_booking INTEGER NOT NULL,
  points_per_1000_cop INTEGER NOT NULL,
  is_enabled BOOLEAN NOT NULL,
  changed_by INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT salon_loyalty_audit_scope FOREIGN KEY (salon_id, business_profile_id)
    REFERENCES salones(id, business_profile_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS salon_loyalty_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id VARCHAR(36) NOT NULL,
  salon_id INTEGER NOT NULL,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(500),
  points_cost INTEGER NOT NULL CHECK (points_cost > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  max_redemptions_per_customer INTEGER CHECK (max_redemptions_per_customer IS NULL OR max_redemptions_per_customer > 0),
  created_by INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT salon_loyalty_reward_scope FOREIGN KEY (salon_id, business_profile_id)
    REFERENCES salones(id, business_profile_id) ON DELETE CASCADE,
  CONSTRAINT salon_loyalty_reward_id_scope UNIQUE (id, business_profile_id, salon_id),
  CONSTRAINT salon_loyalty_reward_name_nonempty CHECK (length(trim(name)) > 0)
);

CREATE TABLE IF NOT EXISTS salon_loyalty_reward_audit (
  id BIGSERIAL PRIMARY KEY,
  business_profile_id VARCHAR(36) NOT NULL,
  salon_id INTEGER NOT NULL,
  reward_id UUID NOT NULL,
  action VARCHAR(16) NOT NULL CHECK (action IN ('CREATED', 'UPDATED')),
  name VARCHAR(100) NOT NULL,
  description VARCHAR(500),
  points_cost INTEGER NOT NULL CHECK (points_cost > 0),
  is_active BOOLEAN NOT NULL,
  changed_by INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT salon_loyalty_reward_audit_scope FOREIGN KEY (salon_id, business_profile_id)
    REFERENCES salones(id, business_profile_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS salon_loyalty_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id VARCHAR(36) NOT NULL,
  salon_id INTEGER NOT NULL,
  customer_user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT salon_loyalty_account_scope FOREIGN KEY (salon_id, business_profile_id)
    REFERENCES salones(id, business_profile_id) ON DELETE CASCADE,
  CONSTRAINT salon_loyalty_account_unique UNIQUE (business_profile_id, salon_id, customer_user_id),
  CONSTRAINT salon_loyalty_account_id_scope UNIQUE (id, business_profile_id, salon_id)
);

CREATE TABLE IF NOT EXISTS salon_loyalty_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES salon_loyalty_accounts(id) ON DELETE RESTRICT,
  business_profile_id VARCHAR(36) NOT NULL,
  salon_id INTEGER NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('AWARD', 'REDEMPTION', 'REFUND', 'ADJUSTMENT', 'EXPIRY')),
  points_delta INTEGER NOT NULL CHECK (points_delta <> 0),
  source_type VARCHAR(30) NOT NULL,
  source_id VARCHAR(100),
  idempotency_key VARCHAR(140) NOT NULL,
  note VARCHAR(300),
  created_by INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT salon_loyalty_movement_scope FOREIGN KEY (account_id, business_profile_id, salon_id)
    REFERENCES salon_loyalty_accounts(id, business_profile_id, salon_id) ON DELETE RESTRICT,
  CONSTRAINT salon_loyalty_movement_direction CHECK (
    (type IN ('AWARD', 'REFUND') AND points_delta > 0) OR
    (type IN ('REDEMPTION', 'EXPIRY') AND points_delta < 0) OR type = 'ADJUSTMENT'
  ),
  CONSTRAINT salon_loyalty_movement_idempotency UNIQUE (account_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS salon_loyalty_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL,
  reward_id UUID NOT NULL,
  business_profile_id VARCHAR(36) NOT NULL,
  salon_id INTEGER NOT NULL,
  points_cost INTEGER NOT NULL CHECK (points_cost > 0),
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'FULFILLED', 'CANCELLED')),
  idempotency_key VARCHAR(140) NOT NULL,
  fulfilled_by INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  fulfilled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT salon_loyalty_redemption_scope FOREIGN KEY (account_id, business_profile_id, salon_id)
    REFERENCES salon_loyalty_accounts(id, business_profile_id, salon_id) ON DELETE RESTRICT,
  CONSTRAINT salon_loyalty_redemption_reward_scope FOREIGN KEY (reward_id, business_profile_id, salon_id)
    REFERENCES salon_loyalty_rewards(id, business_profile_id, salon_id) ON DELETE RESTRICT,
  CONSTRAINT salon_loyalty_redemption_unique UNIQUE (account_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_salon_loyalty_accounts_customer
  ON salon_loyalty_accounts (customer_user_id, business_profile_id, salon_id);
CREATE INDEX IF NOT EXISTS idx_salon_loyalty_movements_account_date
  ON salon_loyalty_movements (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_salon_loyalty_rewards_scope_active
  ON salon_loyalty_rewards (business_profile_id, salon_id, is_active);
CREATE INDEX IF NOT EXISTS idx_salon_loyalty_redemptions_scope_status
  ON salon_loyalty_redemptions (business_profile_id, salon_id, status, created_at DESC);

-- RLS permite lecturas propias al cliente y operaciones del negocio a miembros
-- activos del perfil. La autorización de escritura más fina queda en la API.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'salon_loyalty_programs', 'salon_loyalty_program_audit', 'salon_loyalty_rewards', 'salon_loyalty_accounts',
    'salon_loyalty_reward_audit', 'salon_loyalty_movements', 'salon_loyalty_redemptions'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- La primera validación de producción creó los objetos transaccionalmente; estas
-- políticas se recrean explícitamente para que el runner pueda registrarla.
DROP POLICY IF EXISTS salon_loyalty_program_audit_read ON salon_loyalty_program_audit;
DROP POLICY IF EXISTS salon_loyalty_program_audit_system_write ON salon_loyalty_program_audit;
DROP POLICY IF EXISTS salon_loyalty_reward_audit_read ON salon_loyalty_reward_audit;
DROP POLICY IF EXISTS salon_loyalty_reward_audit_system_write ON salon_loyalty_reward_audit;
DROP POLICY IF EXISTS salon_loyalty_program_access ON salon_loyalty_programs;
DROP POLICY IF EXISTS salon_loyalty_rewards_access ON salon_loyalty_rewards;
DROP POLICY IF EXISTS salon_loyalty_accounts_access ON salon_loyalty_accounts;
DROP POLICY IF EXISTS salon_loyalty_movements_access ON salon_loyalty_movements;
DROP POLICY IF EXISTS salon_loyalty_redemptions_access ON salon_loyalty_redemptions;

CREATE POLICY salon_loyalty_program_audit_read ON salon_loyalty_program_audit
  FOR SELECT USING (business_profile_id = current_setting('app.business_profile_id', true)
    AND EXISTS (SELECT 1 FROM memberships m WHERE m.business_profile_id = salon_loyalty_program_audit.business_profile_id
      AND m.user_id = app_current_user_id() AND m.status = 'ACTIVE'));

CREATE POLICY salon_loyalty_program_audit_system_write ON salon_loyalty_program_audit
  FOR INSERT WITH CHECK (current_user = 'app_system' OR pg_trigger_depth() > 0);

CREATE POLICY salon_loyalty_reward_audit_read ON salon_loyalty_reward_audit
  FOR SELECT USING (business_profile_id = current_setting('app.business_profile_id', true)
    AND EXISTS (SELECT 1 FROM memberships m WHERE m.business_profile_id = salon_loyalty_reward_audit.business_profile_id
      AND m.user_id = app_current_user_id() AND m.status = 'ACTIVE'));

CREATE POLICY salon_loyalty_reward_audit_system_write ON salon_loyalty_reward_audit
  FOR INSERT WITH CHECK (current_user = 'app_system' OR pg_trigger_depth() > 0);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rls_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON salon_loyalty_programs TO app_rls_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON salon_loyalty_rewards TO app_rls_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON salon_loyalty_accounts TO app_rls_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON salon_loyalty_movements TO app_rls_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON salon_loyalty_redemptions TO app_rls_user;
    GRANT SELECT ON salon_loyalty_program_audit TO app_rls_user;
    GRANT SELECT ON salon_loyalty_reward_audit TO app_rls_user;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_system') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON salon_loyalty_programs TO app_system;
    GRANT SELECT, INSERT, UPDATE, DELETE ON salon_loyalty_rewards TO app_system;
    GRANT SELECT, INSERT, UPDATE, DELETE ON salon_loyalty_accounts TO app_system;
    GRANT SELECT, INSERT, UPDATE, DELETE ON salon_loyalty_movements TO app_system;
    GRANT SELECT, INSERT, UPDATE, DELETE ON salon_loyalty_redemptions TO app_system;
    GRANT SELECT, INSERT ON salon_loyalty_program_audit TO app_system;
    GRANT SELECT, INSERT ON salon_loyalty_reward_audit TO app_system;
    GRANT USAGE, SELECT ON SEQUENCE salon_loyalty_program_audit_id_seq TO app_system;
    GRANT USAGE, SELECT ON SEQUENCE salon_loyalty_reward_audit_id_seq TO app_system;
  END IF;
END $$;

-- El historial se considera inmutable desde las credenciales de aplicación.
CREATE OR REPLACE FUNCTION salon_loyalty_reject_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'El historial de reglas de fidelización es inmutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_salon_loyalty_audit_immutable ON salon_loyalty_program_audit;
CREATE TRIGGER trg_salon_loyalty_audit_immutable
  BEFORE UPDATE ON salon_loyalty_program_audit
  FOR EACH ROW EXECUTE FUNCTION salon_loyalty_reject_audit_mutation();

DROP TRIGGER IF EXISTS trg_salon_loyalty_reward_audit_immutable ON salon_loyalty_reward_audit;
CREATE TRIGGER trg_salon_loyalty_reward_audit_immutable
  BEFORE UPDATE ON salon_loyalty_reward_audit
  FOR EACH ROW EXECUTE FUNCTION salon_loyalty_reject_audit_mutation();

-- Las API de cliente usan el rol ordinario y requieren que el trigger de
-- auditoría escriba sin exponer INSERT directo a ese rol.
CREATE OR REPLACE FUNCTION salon_loyalty_audit_program_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO salon_loyalty_program_audit (
    business_profile_id, salon_id, points_per_completed_booking,
    points_per_1000_cop, is_enabled, changed_by
  ) VALUES (
    NEW.business_profile_id, NEW.salon_id, NEW.points_per_completed_booking,
    NEW.points_per_1000_cop, NEW.is_enabled, NEW.updated_by
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION salon_loyalty_audit_program_change() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION salon_loyalty_audit_program_change() TO app_rls_user;

CREATE OR REPLACE FUNCTION salon_loyalty_audit_reward_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO salon_loyalty_reward_audit (
    business_profile_id, salon_id, reward_id, action, name, description, points_cost, is_active, changed_by
  ) VALUES (
    NEW.business_profile_id, NEW.salon_id, NEW.id,
    CASE WHEN TG_OP = 'INSERT' THEN 'CREATED' ELSE 'UPDATED' END,
    NEW.name, NEW.description, NEW.points_cost, NEW.is_active, NEW.updated_by
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION salon_loyalty_audit_reward_change() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION salon_loyalty_audit_reward_change() TO app_rls_user;

DROP TRIGGER IF EXISTS trg_salon_loyalty_program_audit ON salon_loyalty_programs;
CREATE TRIGGER trg_salon_loyalty_program_audit
  AFTER INSERT OR UPDATE ON salon_loyalty_programs
  FOR EACH ROW EXECUTE FUNCTION salon_loyalty_audit_program_change();

DROP TRIGGER IF EXISTS trg_salon_loyalty_reward_audit ON salon_loyalty_rewards;
CREATE TRIGGER trg_salon_loyalty_reward_audit
  AFTER INSERT OR UPDATE ON salon_loyalty_rewards
  FOR EACH ROW EXECUTE FUNCTION salon_loyalty_audit_reward_change();

CREATE POLICY salon_loyalty_program_access ON salon_loyalty_programs
  USING (business_profile_id = current_setting('app.business_profile_id', true)
    AND EXISTS (SELECT 1 FROM memberships m WHERE m.business_profile_id = salon_loyalty_programs.business_profile_id
      AND m.user_id = app_current_user_id() AND m.status = 'ACTIVE'))
  WITH CHECK (business_profile_id = current_setting('app.business_profile_id', true)
    AND EXISTS (SELECT 1 FROM memberships m WHERE m.business_profile_id = salon_loyalty_programs.business_profile_id
      AND m.user_id = app_current_user_id() AND m.status = 'ACTIVE'
      AND m.role IN ('OWNER','ADMIN','MANAGER')));

CREATE POLICY salon_loyalty_rewards_access ON salon_loyalty_rewards
  USING (business_profile_id = current_setting('app.business_profile_id', true)
    AND EXISTS (SELECT 1 FROM memberships m WHERE m.business_profile_id = salon_loyalty_rewards.business_profile_id
      AND m.user_id = app_current_user_id() AND m.status = 'ACTIVE'))
  WITH CHECK (business_profile_id = current_setting('app.business_profile_id', true)
    AND EXISTS (SELECT 1 FROM memberships m WHERE m.business_profile_id = salon_loyalty_rewards.business_profile_id
      AND m.user_id = app_current_user_id() AND m.status = 'ACTIVE'
      AND m.role IN ('OWNER','ADMIN','MANAGER')));

CREATE POLICY salon_loyalty_accounts_access ON salon_loyalty_accounts
  USING (business_profile_id = current_setting('app.business_profile_id', true)
    AND (customer_user_id = app_current_user_id()
      OR EXISTS (SELECT 1 FROM memberships m WHERE m.business_profile_id = salon_loyalty_accounts.business_profile_id
        AND m.user_id = app_current_user_id() AND m.status = 'ACTIVE')))
  WITH CHECK (business_profile_id = current_setting('app.business_profile_id', true)
    AND EXISTS (SELECT 1 FROM memberships m WHERE m.business_profile_id = salon_loyalty_accounts.business_profile_id
      AND m.user_id = app_current_user_id() AND m.status = 'ACTIVE'));

CREATE POLICY salon_loyalty_movements_access ON salon_loyalty_movements
  USING (business_profile_id = current_setting('app.business_profile_id', true)
    AND (EXISTS (SELECT 1 FROM salon_loyalty_accounts a WHERE a.id = salon_loyalty_movements.account_id
        AND a.customer_user_id = app_current_user_id())
      OR EXISTS (SELECT 1 FROM memberships m WHERE m.business_profile_id = salon_loyalty_movements.business_profile_id
        AND m.user_id = app_current_user_id() AND m.status = 'ACTIVE')))
  WITH CHECK (business_profile_id = current_setting('app.business_profile_id', true)
    AND EXISTS (SELECT 1 FROM memberships m WHERE m.business_profile_id = salon_loyalty_movements.business_profile_id
      AND m.user_id = app_current_user_id() AND m.status = 'ACTIVE'
      AND m.role IN ('OWNER','ADMIN','MANAGER')));

CREATE POLICY salon_loyalty_redemptions_access ON salon_loyalty_redemptions
  USING (business_profile_id = current_setting('app.business_profile_id', true)
    AND (EXISTS (SELECT 1 FROM salon_loyalty_accounts a WHERE a.id = salon_loyalty_redemptions.account_id
        AND a.customer_user_id = app_current_user_id())
      OR EXISTS (SELECT 1 FROM memberships m WHERE m.business_profile_id = salon_loyalty_redemptions.business_profile_id
        AND m.user_id = app_current_user_id() AND m.status = 'ACTIVE')))
  WITH CHECK (business_profile_id = current_setting('app.business_profile_id', true)
    AND EXISTS (SELECT 1 FROM memberships m WHERE m.business_profile_id = salon_loyalty_redemptions.business_profile_id
      AND m.user_id = app_current_user_id() AND m.status = 'ACTIVE'
      AND m.role IN ('OWNER','ADMIN','MANAGER')));

COMMENT ON TABLE salon_loyalty_programs IS
  'Reglas de puntos decididas por cada salón; aisladas del programa global points_lots.';
COMMENT ON TABLE salon_loyalty_movements IS
  'Libro append-only de puntos propios del salón; delta positivo acredita y negativo consume.';

COMMIT;

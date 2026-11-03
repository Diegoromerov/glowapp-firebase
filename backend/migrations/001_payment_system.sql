-- ============================================================
-- MIGRACIÓN 001: Sistema de Pagos Completo
-- Beauty App — Ejecutar sobre DB existente
-- ============================================================

-- ─── NUEVOS ENUMs ───────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE modelo_retiro_enum AS ENUM ('DEMANDA', 'QUINCENA', 'MENSUAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tipo_wallet_tx AS ENUM (
    'CREDITO_SERVICIO',
    'DEBITO_RETIRO',
    'RETENCION_DISPUTA',
    'LIBERACION_DISPUTA',
    'AJUSTE_ADMIN',
    'BONO_CANCELACION'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tipo_disputa AS ENUM (
    'CALIDAD_SERVICIO',
    'NO_SHOW_PRESTADOR',
    'NO_SHOW_CLIENTE',
    'OTP_BLOQUEADO',
    'CARGO_NO_RECONOCIDO',
    'FRAUDE',
    'FALLA_TECNICA'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE estado_disputa AS ENUM (
    'ABIERTA',
    'EN_REVISION',
    'RESUELTA',
    'CERRADA'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE resolucion_disputa AS ENUM (
    'FAVOR_PRESTADOR',
    'REEMBOLSO_TOTAL',
    'DIVISION',
    'COMPENSACION_PLATAFORMA'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE estado_retiro AS ENUM (
    'PENDIENTE',
    'PROCESANDO',
    'COMPLETADO',
    'FALLIDO'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── ACTUALIZAR estado_cita CON NUEVOS ESTADOS ─────────────

-- Agregar nuevos valores al ENUM existente sin recrearlo
DO $$ BEGIN
  ALTER TYPE estado_cita ADD VALUE IF NOT EXISTS 'CHECKIN_REALIZADO';
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE estado_cita ADD VALUE IF NOT EXISTS 'ESPERANDO_OTP';
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE estado_cita ADD VALUE IF NOT EXISTS 'EN_DISPUTA';
EXCEPTION WHEN others THEN NULL; END $$;

-- ─── TABLA: platform_config ─────────────────────────────────

CREATE TABLE IF NOT EXISTS platform_config (
  key   VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL,
  descripcion TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by INTEGER REFERENCES usuarios(id) ON DELETE SET NULL
);

-- Valores por defecto del sistema
INSERT INTO platform_config (key, value, descripcion) VALUES
  ('comision_plataforma_pct', '20',  'Porcentaje de comisión sobre cada servicio'),
  ('otp_vigencia_minutos',    '45',  'Minutos de validez del OTP de confirmación'),
  ('otp_max_intentos',        '3',   'Intentos máximos antes de bloquear OTP'),
  ('wallet_ventana_pendiente_horas', '2', 'Horas de espera post-OTP para pasar a disponible'),
  ('retiro_demanda_min_cop',  '50000', 'Monto mínimo para retiro por demanda en COP'),
  ('retiro_demanda_dias',     '3',   'Días mínimos entre retiros por demanda'),
  ('retiro_auto_min_cop',     '20000','Monto mínimo para retiros automáticos'),
  ('gps_tolerancia_metros',   '500', 'Radio GPS permitido para check-in'),
  ('disputa_ventana_horas',   '2',   'Horas para abrir disputa tras OTP validado'),
  ('disputa_max_reembolso_pct','50', 'Máximo % reembolsable cuando OTP ya fue usado'),
  ('cancelacion_libre_horas', '24',  'Horas de anticipación para cancelación sin penalidad'),
  ('riesgo_suspender_score',  '50',  'Risk score que pausa retiros del prestador')
ON CONFLICT (key) DO NOTHING;

-- ─── TABLA: provider_wallet ─────────────────────────────────

CREATE TABLE IF NOT EXISTS provider_wallet (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id          INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  saldo_disponible     NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (saldo_disponible >= 0),
  saldo_pendiente      NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (saldo_pendiente >= 0),
  saldo_en_disputa     NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (saldo_en_disputa >= 0),
  total_ganado         NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  total_retirado       NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  modelo_retiro        modelo_retiro_enum NOT NULL DEFAULT 'DEMANDA',
  ultimo_retiro_at     TIMESTAMPTZ,
  proximo_retiro_auto  TIMESTAMPTZ,
  risk_score           INTEGER NOT NULL DEFAULT 0 CHECK (risk_score >= 0),
  retiros_pausados     BOOLEAN NOT NULL DEFAULT FALSE,
  -- Datos bancarios para payout
  tipo_cuenta          VARCHAR(20),          -- 'NEQUI' | 'DAVIPLATA' | 'BANCARIA'
  banco                VARCHAR(100),
  numero_cuenta        VARCHAR(30),
  tipo_cuenta_bancaria VARCHAR(20),          -- 'AHORROS' | 'CORRIENTE'
  cuenta_verificada    BOOLEAN NOT NULL DEFAULT FALSE,
  wompi_beneficiary_id VARCHAR(255),         -- ID del beneficiario en Wompi
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_provider_wallet UNIQUE (provider_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_wallet_provider ON provider_wallet(provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_wallet_retiro ON provider_wallet(ultimo_retiro_at);

-- ─── TABLA: wallet_transactions ─────────────────────────────

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id       INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  booking_id        UUID REFERENCES bookings(id) ON DELETE SET NULL,
  tipo              tipo_wallet_tx NOT NULL,
  monto             NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  saldo_resultante  NUMERIC(12,2) NOT NULL,          -- Snapshot del saldo tras la tx
  estado            VARCHAR(20) NOT NULL DEFAULT 'COMPLETADO'
                    CHECK (estado IN ('PENDIENTE','COMPLETADO','REVERTIDO')),
  referencia_wompi  VARCHAR(255),
  descripcion       TEXT,
  metadata          JSONB DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  -- Inmutabilidad: esta tabla NUNCA se actualiza, solo se inserta
  CONSTRAINT chk_monto_positivo CHECK (monto > 0)
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_provider ON wallet_transactions(provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_booking  ON wallet_transactions(booking_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_tipo     ON wallet_transactions(tipo);

-- ─── TABLA: otp_validaciones ────────────────────────────────

CREATE TABLE IF NOT EXISTS otp_validaciones (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  codigo_hash      VARCHAR(255) NOT NULL,             -- bcrypt hash del código de 6 dígitos
  generado_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expira_at        TIMESTAMPTZ NOT NULL,              -- generado_at + 45 min
  usado_at         TIMESTAMPTZ,
  intentos_fallidos INTEGER NOT NULL DEFAULT 0,
  estado           VARCHAR(20) NOT NULL DEFAULT 'ACTIVO'
                   CHECK (estado IN ('ACTIVO','USADO','EXPIRADO','BLOQUEADO')),
  ip_generacion    INET,
  CONSTRAINT uq_otp_booking UNIQUE (booking_id)      -- 1 OTP activo por reserva
);

CREATE INDEX IF NOT EXISTS idx_otp_booking ON otp_validaciones(booking_id);
CREATE INDEX IF NOT EXISTS idx_otp_expira  ON otp_validaciones(expira_at);

-- ─── TABLA: retiros ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS retiros (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id       INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  wallet_id         UUID NOT NULL REFERENCES provider_wallet(id) ON DELETE RESTRICT,
  monto             NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  estado            estado_retiro NOT NULL DEFAULT 'PENDIENTE',
  tipo_origen       VARCHAR(20) NOT NULL DEFAULT 'DEMANDA'
                    CHECK (tipo_origen IN ('DEMANDA','QUINCENA','MENSUAL')),
  referencia_wompi  VARCHAR(255),
  error_wompi       TEXT,
  numero_cuenta     VARCHAR(30),                     -- Snapshot de la cuenta al momento del retiro
  banco             VARCHAR(100),
  solicitado_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  procesado_at      TIMESTAMPTZ,
  metadata          JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_retiros_provider ON retiros(provider_id, solicitado_at DESC);
CREATE INDEX IF NOT EXISTS idx_retiros_estado   ON retiros(estado);

-- ─── TABLA: disputas ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS disputas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  iniciado_por    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  tipo_actor      VARCHAR(20) NOT NULL CHECK (tipo_actor IN ('CLIENTE','PRESTADOR','SISTEMA')),
  tipo            tipo_disputa NOT NULL,
  descripcion     TEXT,
  evidencia_urls  TEXT[] DEFAULT '{}',
  monto_disputado NUMERIC(12,2) NOT NULL,
  estado          estado_disputa NOT NULL DEFAULT 'ABIERTA',
  -- Resolución
  resuelto_por    INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  resolucion      resolucion_disputa,
  porcentaje_prestador NUMERIC(5,2),               -- Para resolución DIVISION
  nota_resolucion TEXT,
  -- Timestamps
  creado_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resuelto_at     TIMESTAMPTZ,
  -- SLA
  sla_limite_at   TIMESTAMPTZ
);

-- Trigger para SLA en disputas
CREATE OR REPLACE FUNCTION set_disputa_sla()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.sla_limite_at IS NULL THEN
    NEW.sla_limite_at = NEW.creado_at + INTERVAL '48 hours';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_disputa_sla ON disputas;
CREATE TRIGGER trg_disputa_sla
  BEFORE INSERT ON disputas
  FOR EACH ROW EXECUTE FUNCTION set_disputa_sla();

CREATE INDEX IF NOT EXISTS idx_disputas_booking  ON disputas(booking_id);
CREATE INDEX IF NOT EXISTS idx_disputas_estado   ON disputas(estado, creado_at DESC);
CREATE INDEX IF NOT EXISTS idx_disputas_sla      ON disputas(sla_limite_at) WHERE estado IN ('ABIERTA','EN_REVISION');

-- ─── TABLA: audit_log ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  accion      VARCHAR(100) NOT NULL,
  tabla       VARCHAR(100) NOT NULL,
  registro_id VARCHAR(255),
  datos_antes JSONB,
  datos_despues JSONB,
  ip          INET,
  creado_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para búsqueda eficiente en auditoría
CREATE INDEX IF NOT EXISTS idx_audit_actor  ON audit_log(actor_id, creado_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_tabla  ON audit_log(tabla, registro_id);
CREATE INDEX IF NOT EXISTS idx_audit_fecha  ON audit_log(creado_at DESC);

-- ─── TRIGGER: updated_at automático para provider_wallet ────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wallet_updated_at ON provider_wallet;
CREATE TRIGGER trg_wallet_updated_at
  BEFORE UPDATE ON provider_wallet
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_disputa_updated_at ON disputas;
CREATE TRIGGER trg_disputa_updated_at
  BEFORE UPDATE ON disputas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── ACTUALIZAR TRIGGER DE COMISIONES EN BOOKINGS ───────────
-- El trigger existente calculaba 20% plataforma + 8% impuesto.
-- Nuevo: solo 20% comisión, 0% impuesto (el IVA lo maneja el prestador).

CREATE OR REPLACE FUNCTION calc_booking_split()
RETURNS TRIGGER AS $$
BEGIN
  -- La comisión total cobrada al prestador es del 20%, la cual contiene un 8% de impuestos y 12% de comisión neta.
  NEW.comision_plataforma  := ROUND(NEW.valor_bruto * 0.12, 2);
  NEW.impuestos_estado     := ROUND(NEW.valor_bruto * 0.08, 2);
  NEW.pago_neto_prestador  := NEW.valor_bruto - (NEW.comision_plataforma + NEW.impuestos_estado);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── FUNCIÓN: auto-crear wallet al registrar prestador ───────

CREATE OR REPLACE FUNCTION crear_wallet_prestador()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO provider_wallet (provider_id)
  VALUES (NEW.id)
  ON CONFLICT (provider_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_crear_wallet ON perfiles_prestador;
CREATE TRIGGER trg_crear_wallet
  AFTER INSERT ON perfiles_prestador
  FOR EACH ROW EXECUTE FUNCTION crear_wallet_prestador();

-- ─── FUNCIÓN: expirar OTPs vencidos ─────────────────────────

CREATE OR REPLACE FUNCTION expirar_otps_vencidos()
RETURNS INTEGER AS $$
DECLARE
  filas_actualizadas INTEGER;
BEGIN
  UPDATE otp_validaciones
  SET estado = 'EXPIRADO'
  WHERE estado = 'ACTIVO'
    AND expira_at < NOW();
  GET DIAGNOSTICS filas_actualizadas = ROW_COUNT;
  RETURN filas_actualizadas;
END;
$$ LANGUAGE plpgsql;

-- ─── ÍNDICES ADICIONALES EN BOOKINGS ─────────────────────────

CREATE INDEX IF NOT EXISTS idx_bookings_provider_estado
  ON bookings(provider_id, estado);

CREATE INDEX IF NOT EXISTS idx_bookings_client_estado
  ON bookings(client_id, estado);

-- ─── FIN DE MIGRACIÓN ─────────────────────────────────────────
-- Para verificar: SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' ORDER BY table_name;

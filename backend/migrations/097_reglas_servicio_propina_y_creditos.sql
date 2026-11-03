-- ============================================================
-- MIGRACIÓN 097: Reglas de servicio — cancelación, reprogramación,
--                propina y créditos
-- Fases F4, F5 y F6 del plan de implementación
--
-- F4 — Cancelación por tramos, reprogramación única y ventana de disputa
--   · `completed_at`: la ventana de 48 h de disputa necesita saber cuándo
--     terminó el servicio (antes solo se cambiaba el estado, sin marca de tiempo).
--   · `reschedule_count`: una reprogramación gratis, la segunda es cancelación.
--   · `reembolsos`: el reembolso parcial del tramo 2–24 h necesita un asiento
--     propio; antes no existía ninguna tabla de devoluciones.
--
-- F5 — Propina al prestador, 100% suya y sin comisión.
--
-- F6 — Créditos: compensación en créditos, no retirables, con vencimiento.
--
-- Idempotente: IF NOT EXISTS en todo.
-- ============================================================

BEGIN;

-- ─── F4 · Columnas de la reserva ────────────────────────────────────────────

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS completed_at      TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reschedule_count  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS propina           NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancelado_por     VARCHAR(20);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS credito_aplicado  NUMERIC(10,2) NOT NULL DEFAULT 0;

-- ─── F4 · Reembolsos ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reembolsos (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id            UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  client_id             INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  monto                 NUMERIC(12,2) NOT NULL CHECK (monto >= 0),
  porcentaje_devolucion NUMERIC(5,2) NOT NULL CHECK (porcentaje_devolucion BETWEEN 0 AND 100),
  tramo                 VARCHAR(20) NOT NULL
                        CHECK (tramo IN ('MAS_24H','ENTRE_2_Y_24H','MENOS_2H','CANCELA_PRESTADOR')),
  motivo                TEXT,
  estado                VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'
                        CHECK (estado IN ('PENDIENTE','PROCESADO','FALLIDO')),
  referencia_pasarela   VARCHAR(255),
  creado_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  procesado_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reembolsos_booking ON reembolsos(booking_id);
CREATE INDEX IF NOT EXISTS idx_reembolsos_estado  ON reembolsos(estado);

-- ─── F5 · Propinas ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS propinas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  client_id        INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  provider_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  monto            NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  estado           VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'
                   CHECK (estado IN ('PENDIENTE','PAGADA','ANULADA')),
  referencia_wompi VARCHAR(255),
  creado_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pagado_at        TIMESTAMPTZ,
  -- Una propina por servicio: el cliente puede dejarla una vez, no sumar varias.
  CONSTRAINT uq_propina_booking UNIQUE (booking_id)
);

CREATE INDEX IF NOT EXISTS idx_propinas_provider ON propinas(provider_id, pagado_at DESC);

-- ─── F6 · Créditos ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS creditos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id     INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  origen         VARCHAR(30) NOT NULL
                 CHECK (origen IN ('NO_SHOW_PRESTADOR','BONO_REEMBOLSO','AJUSTE','PROMOCION')),
  referencia_id  UUID,
  monto_inicial  NUMERIC(12,2) NOT NULL CHECK (monto_inicial > 0),
  saldo          NUMERIC(12,2) NOT NULL CHECK (saldo >= 0),
  vence_at       TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '90 days'),
  creado_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creditos_usuario ON creditos(usuario_id, vence_at);

CREATE TABLE IF NOT EXISTS creditos_movimientos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credito_id UUID NOT NULL REFERENCES creditos(id) ON DELETE RESTRICT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  tipo       VARCHAR(12) NOT NULL CHECK (tipo IN ('EMISION','USO','VENCIMIENTO')),
  monto      NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  creado_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creditos_mov_usuario ON creditos_movimientos(usuario_id, creado_at DESC);

COMMIT;

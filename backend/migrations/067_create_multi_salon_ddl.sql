-- ============================================================================
-- Migración 067: DDL Declarativo Completo de Esquema Multi-Sede (SaaS)
-- ============================================================================
-- Garantiza que una instalación desde cero contenga las tablas del módulo
-- multi-sede: salones, salon_miembros y salon_invitaciones.
--
-- CONTRATO: este archivo se derivó del uso real que el código hace de las
-- tablas, NO al revés. Cada columna de aquí está respaldada por una sentencia
-- de producción concreta (se cita el archivo:línea). Si el código cambia, esta
-- migración debe cambiar con él; la forma de comprobarlo es ejecutar el
--   backend/scripts/verifyMultiSalonDDL.js
-- que corre las sentencias reales del backend contra este esquema.
--
-- Idempotente: CREATE TABLE / INDEX IF NOT EXISTS.
--
-- DEPENDENCIA: PostGIS. Se crea aquí de forma explícita y si no está
-- disponible la migración FALLA en voz alta (no se degrada en silencio: sin el
-- tipo geography no hay búsqueda por proximidad, que es la razón de existir de
-- las columnas de ubicación).
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------------
-- 1. salones
--    Columnas exigidas por:
--      salonController.js:12   SELECT s.id, s.nombre_salon, s.nit, s.direccion,
--                                     s.telefono, s.ciudad, s.plan_saas, s.id_dueno
--      salonController.js:85   INSERT (nombre_salon, nit, direccion, telefono,
--                                     ciudad, id_dueno, plan_saas, latitude,
--                                     longitude, ubicacion, location_enabled,
--                                     location_public)
--      ownerController.js:16   s.latitude, s.longitude, s.location_enabled,
--                                     s.location_public
--      providerController.js:95 ST_Distance(s.ubicacion, ...)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS salones (
    id               SERIAL PRIMARY KEY,
    tenant_id        INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
    id_dueno         INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    nombre_salon     VARCHAR(255) NOT NULL,
    nit              VARCHAR(50),
    direccion        TEXT,
    telefono         VARCHAR(50),
    ciudad           VARCHAR(100),
    plan_saas        VARCHAR(50) NOT NULL DEFAULT 'FREE_TRIAL',
    latitude         NUMERIC(10, 7),
    longitude        NUMERIC(10, 7),
    ubicacion        geography(Point, 4326),
    location_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    location_public  BOOLEAN NOT NULL DEFAULT TRUE,
    creado_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 2. salon_miembros
--    Columnas exigidas por:
--      salonController.js:116  INSERT (salon_id, user_id, sub_rol, estatus)
--                              + ON CONFLICT (salon_id, user_id)
--      authController.js:100   WHERE sm.user_id = $1 AND sm.estatus = 'ACTIVO'
--      ownerController.js:17   COUNT(DISTINCT sm.user_id) FILTER (WHERE sm.estatus = 'ACTIVO')
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS salon_miembros (
    id         SERIAL PRIMARY KEY,
    salon_id   INTEGER NOT NULL REFERENCES salones(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    tenant_id  INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
    sub_rol    VARCHAR(50) NOT NULL DEFAULT 'ESTILISTA',
    estatus    VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',
    creado_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_salon_miembro UNIQUE (salon_id, user_id)
);

-- ---------------------------------------------------------------------------
-- 3. salon_invitaciones
--    Columnas exigidas por:
--      salonController.js:174  INSERT (salon_id, email, sub_rol,
--                                      token_invitacion, expires_at, creado_por)
--      salonController.js:208  SELECT id, salon_id, email, sub_rol, expires_at,
--                                      usado ... WHERE token_invitacion = $1
--                                      AND usado = false AND expires_at > NOW()
--      migrations/066:18       length(token_invitacion) = 32  (legado en claro)
--      -> token_invitacion admite 32 (legado) y 64 (sha256 hex): VARCHAR(64)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS salon_invitaciones (
    id               SERIAL PRIMARY KEY,
    salon_id         INTEGER NOT NULL REFERENCES salones(id) ON DELETE CASCADE,
    tenant_id        INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
    email            VARCHAR(150) NOT NULL,
    sub_rol          VARCHAR(50) NOT NULL,
    token_invitacion VARCHAR(64) NOT NULL UNIQUE,
    usado            BOOLEAN NOT NULL DEFAULT FALSE,
    creado_por       INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    expires_at       TIMESTAMP WITH TIME ZONE NOT NULL,
    creado_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 4. Índices
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_salones_dueno            ON salones(id_dueno);
CREATE INDEX IF NOT EXISTS idx_salones_tenant           ON salones(tenant_id);
CREATE INDEX IF NOT EXISTS idx_salones_ubicacion_gist   ON salones USING GIST(ubicacion);
CREATE INDEX IF NOT EXISTS idx_salon_miembros_user      ON salon_miembros(user_id);
CREATE INDEX IF NOT EXISTS idx_salon_miembros_salon     ON salon_miembros(salon_id);
CREATE INDEX IF NOT EXISTS idx_salon_miembros_tenant    ON salon_miembros(tenant_id);
CREATE INDEX IF NOT EXISTS idx_salon_invitaciones_token ON salon_invitaciones(token_invitacion);
CREATE INDEX IF NOT EXISTS idx_salon_invitaciones_email ON salon_invitaciones(email);

COMMIT;

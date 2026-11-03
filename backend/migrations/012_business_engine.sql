-- ===========================================================================
-- 012_business_engine.sql — DDL del GlowApp Business Engine
-- ===========================================================================
-- Traído desde `src/db/migrations/012_business_engine.sql`, un directorio que el
-- arranque NUNCA lee: index.js:1617-1621 hace
--   fs.readdirSync(path.join(__dirname,'migrations')).filter(f => f.endsWith('.sql')).sort()
-- (no recursivo, alfabético). Por eso `beauty_db` no tenía NINGUNA tabla del
-- Business Engine y `062_optimize_business_saas_postgres.sql` fallaba: indexa y
-- aplica RLS sobre tablas que no existían.
--
-- El número 012 (y no 069) es deliberado: 062 debe correr DESPUÉS de este DDL,
-- y el runner ordena alfabéticamente. Ya hay prefijos repetidos en este
-- directorio (003, 004, 008, 011, 012, 026, 034, 035).
--
-- Idempotente: todo es CREATE ... IF NOT EXISTS / DO $$ con guardas, así que se
-- puede re-ejecutar en cada arranque sin efectos.
--
-- ---------------------------------------------------------------------------
-- DECISIONES DE TIPO (con la evidencia, no a ojo)
-- ---------------------------------------------------------------------------
-- 1. `provider_id` = INTEGER, no VARCHAR(36).
--    El DDL original decía `VARCHAR(36) NOT NULL REFERENCES providers(id)` y
--    `providers` no existe en ningún punto de este repositorio. La autoridad es
--    el código que escribe el valor: businessController.js:45,74,95,113,145,196
--    -> `const providerId = req.user.id`. Ese id es el de `usuarios` y es
--    INTEGER: ownerController.js:185 filtra `provider_id = ANY($1::int[])` y
--    ownerController.js:90 lo obtiene como `sm.user_id`. Por eso la FK apunta a
--    usuarios(id) y el tipo es INTEGER: VARCHAR(36) no puede llevar FK contra un
--    id entero, y el tipo UUID era de otro producto.
--
-- 2. Los `id` de negocio (business_profiles.id, business_tasks.id, ...) siguen
--    siendo VARCHAR(36). No es capricho: 062 define
--    `calculate_glowapp_business_score(p_profile_id TEXT)` y compara
--    `business_profile_id = p_profile_id`, lo que exige texto comparable.
--
-- 3. `tenant_id` = VARCHAR(64) DEFAULT 'default', no INTEGER.
--    Dos razones, ambas del código existente:
--      a) businessRepository.js:517,541,597 escribe `tenant_id || 'default'`
--         (centinela de texto) y businessRepository.js:598 escribe
--         `provider_id || 'system'`.
--      b) 062:72 crea la política de aislamiento comparando
--         `tenant_id = current_setting('app.tenant_id', true)` SIN cast: con una
--         columna INTEGER eso es `integer = text` y PostgreSQL aborta la
--         migración entera.
--    Las tablas del salón usan `tenant_id INTEGER` (065) porque están dentro del
--    régimen de 068; estas seis no están en la lista de 068, así que no se les
--    impone ese convenio. Unificarlo es una migración aparte (habría que castear
--    la política de 062 y convertir las columnas).
--
-- 4. `document_audit_logs.provider_id` y `actor_id` son VARCHAR(64) con DEFAULT
--    'system' porque el repositorio escribe ese centinela; en un registro de
--    auditoría un actor «sistema» es legítimo y con INTEGER la fila se perdería
--    (el INSERT está dentro de un catch vacío en businessRepository.js:612).
--
-- 5. Las seis tablas que 062 mete en su bucle de RLS
--    (business_profiles, business_tasks, business_evidences, business_findings,
--    business_documents, document_audit_logs) llevan `tenant_id` obligatorio: la
--    política referencia esa columna y sin ella el CREATE POLICY falla.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Catálogo de verticales
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_verticals (
  id            VARCHAR(36) PRIMARY KEY,
  code          VARCHAR(50) NOT NULL UNIQUE,
  name          VARCHAR(100) NOT NULL,
  description   TEXT,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 2. Perfiles de negocio
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_profiles (
  id               VARCHAR(36) PRIMARY KEY,
  provider_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  vertical_id      VARCHAR(36) NOT NULL REFERENCES business_verticals(id),
  name             VARCHAR(150) NOT NULL,
  onboarding_mode  VARCHAR(30) NOT NULL DEFAULT 'NEW_BUSINESS'
                     CHECK (onboarding_mode IN ('NEW_BUSINESS', 'EXISTING_BUSINESS')),
  lifecycle_stage  VARCHAR(30) NOT NULL DEFAULT 'IDEA'
                     CHECK (lifecycle_stage IN ('IDEA', 'CONSTITUTION', 'FORMALIZATION',
                                                'PREPARATION', 'OPENING', 'OPERATION',
                                                'AUDIT', 'GROWTH')),
  compliance_score NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  city             VARCHAR(100) DEFAULT 'Bogotá',
  country          VARCHAR(100) DEFAULT 'Colombia',
  metadata         JSONB DEFAULT '{}'::jsonb,
  tenant_id        VARCHAR(64) NOT NULL DEFAULT 'default',
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 3. Requisitos legales por vertical
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_requirements (
  id                VARCHAR(36) PRIMARY KEY,
  vertical_id       VARCHAR(36) REFERENCES business_verticals(id),
  code              VARCHAR(50) NOT NULL UNIQUE,
  title             VARCHAR(150) NOT NULL,
  description       TEXT,
  legal_basis       TEXT,
  jurisdiction      VARCHAR(50) DEFAULT 'NATIONAL',
  domain_context    VARCHAR(30) NOT NULL
                      CHECK (domain_context IN ('LEGAL', 'LABOR', 'SANITARY', 'TAX', 'SST', 'OPERATIONS')),
  evidence_required VARCHAR(50) DEFAULT 'DOCUMENT',
  frequency_months  INT DEFAULT 12,
  tenant_id         VARCHAR(64) NOT NULL DEFAULT 'default',
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 4. Tareas guiadas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_tasks (
  id                  VARCHAR(36) PRIMARY KEY,
  business_profile_id VARCHAR(36) NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
  requirement_id      VARCHAR(36) REFERENCES business_requirements(id),
  title               VARCHAR(150) NOT NULL,
  description         TEXT,
  stage               VARCHAR(20) NOT NULL DEFAULT 'ENTENDER'
                        CHECK (stage IN ('ENTENDER', 'EXPLICAR', 'RECOMENDAR', 'EJECUTAR', 'VERIFICAR')),
  status              VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING', 'IN_PROGRESS', 'SUBMITTED', 'VERIFIED', 'EXPIRED')),
  due_date            TIMESTAMP WITH TIME ZONE,
  metadata            JSONB DEFAULT '{}'::jsonb,
  tenant_id           VARCHAR(64) NOT NULL DEFAULT 'default',
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 5. Evidencias y hallazgos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_evidences (
  id               VARCHAR(36) PRIMARY KEY,
  task_id          VARCHAR(36) NOT NULL REFERENCES business_tasks(id) ON DELETE CASCADE,
  file_path        VARCHAR(255),
  evidence_type    VARCHAR(30) NOT NULL DEFAULT 'DOCUMENT'
                     CHECK (evidence_type IN ('DOCUMENT', 'PHOTO', 'CONTRACT', 'FORM', 'DECLARATION')),
  validation_state VARCHAR(30) NOT NULL DEFAULT 'USER_DECLARED'
                     CHECK (validation_state IN ('USER_DECLARED', 'EVIDENCE_SUBMITTED',
                                                 'EVIDENCE_VALIDATED', 'REQUIREMENT_VERIFIED')),
  reviewer_notes   TEXT,
  verified_at      TIMESTAMP WITH TIME ZONE,
  tenant_id        VARCHAR(64) NOT NULL DEFAULT 'default',
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS business_findings (
  id                  VARCHAR(36) PRIMARY KEY,
  business_profile_id VARCHAR(36) NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
  title               VARCHAR(150) NOT NULL,
  description         TEXT,
  risk_level          VARCHAR(20) NOT NULL DEFAULT 'MEDIUM'
                        CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  status              VARCHAR(20) NOT NULL DEFAULT 'OPEN'
                        CHECK (status IN ('OPEN', 'MITIGATED', 'CLOSED')),
  mitigation_plan     TEXT,
  tenant_id           VARCHAR(64) NOT NULL DEFAULT 'default',
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 6. Plantillas de documentos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_templates (
  id            VARCHAR(36) PRIMARY KEY,
  code          VARCHAR(50) NOT NULL UNIQUE,
  title         VARCHAR(150) NOT NULL,
  category      VARCHAR(50) NOT NULL,
  template_body TEXT NOT NULL,
  disclaimer    TEXT NOT NULL,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 7. Documentos generados y firmas
--    Columnas tomadas de businessRepository.js:
--      :532-534  INSERT (id, template_code, business_profile_id, provider_id,
--                        tenant_id, title, category, rendered_body, watermark,
--                        disclaimer, version, status, created_at, updated_at)
--      :574-579  UPDATE status, signed_by, signature_hash, signed_at, updated_at
--    No tenían DDL en NINGUNA parte del repositorio: solo las indexaba 062, las
--    borraba 063 y las consultaba businessRepository.js.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_documents (
  id                  VARCHAR(64) PRIMARY KEY,
  template_code       VARCHAR(50),
  business_profile_id VARCHAR(36) REFERENCES business_profiles(id) ON DELETE SET NULL,
  provider_id         INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  tenant_id           VARCHAR(64) NOT NULL DEFAULT 'default',
  title               VARCHAR(200),
  category            VARCHAR(50),
  rendered_body       TEXT,
  watermark           VARCHAR(100),
  disclaimer          TEXT,
  version             INTEGER NOT NULL DEFAULT 1,
  status              VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  signed_by           INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  signature_hash      VARCHAR(128),
  signed_at           TIMESTAMP WITH TIME ZONE,
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 8. Rastro de auditoría de documentos
--    Columnas de businessRepository.js:607-609.
--    `metadata` es TEXT a propósito: el repositorio guarda un JSON serializado
--    (businessRepository.js:601) y 062:40-45 lo convierte a JSONB.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_audit_logs (
  id          VARCHAR(64) PRIMARY KEY,
  document_id VARCHAR(64) NOT NULL REFERENCES business_documents(id) ON DELETE CASCADE,
  tenant_id   VARCHAR(64) NOT NULL DEFAULT 'default',
  provider_id VARCHAR(64) NOT NULL DEFAULT 'system',
  actor_id    VARCHAR(64) NOT NULL DEFAULT 'system',
  action      VARCHAR(50) NOT NULL,
  metadata    TEXT,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 9. Índices
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_business_profiles_provider  ON business_profiles(provider_id);
CREATE INDEX IF NOT EXISTS idx_business_tasks_profile      ON business_tasks(business_profile_id);
CREATE INDEX IF NOT EXISTS idx_business_evidences_task     ON business_evidences(task_id);
CREATE INDEX IF NOT EXISTS idx_business_findings_profile   ON business_findings(business_profile_id);
CREATE INDEX IF NOT EXISTS idx_business_requirements_vert  ON business_requirements(vertical_id);
CREATE INDEX IF NOT EXISTS idx_business_documents_provider ON business_documents(provider_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_document         ON document_audit_logs(document_id);

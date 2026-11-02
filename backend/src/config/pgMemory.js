/**
 * backend/src/config/pgMemory.js
 *
 * HARNESS DE BASE DE DATOS EN MEMORIA (solo NODE_ENV=test o USE_PG_MEM=true)
 *
 * Por qué existe este archivo:
 *   Antes había DOS bases de datos distintas en modo test.
 *   - Sequelize (src/config/database.js) creaba un pg-mem SIN esquema -> toda query de modelo moría
 *     con 'relation "memberships" does not exist' (las suites business* daban 500).
 *   - El pool crudo (src/config/db.js) no usaba pg-mem en absoluto: caía en handleMemoryQuery,
 *     que devuelve filas fabricadas -> los repositorios SQL nunca se ejercitaban de verdad.
 *   Ahora hay UNA sola instancia de pg-mem, con esquema y datos de referencia, compartida por
 *   Sequelize y por el pool crudo. Así las suites de integración hablan con un Postgres real (en
 *   memoria) en vez de con mocks.
 *
 * Seguridad en producción: pg-mem es devDependency (no existe en la imagen: `npm ci --only=production`),
 * por eso el require va en try/catch: si no está instalado, el módulo queda desactivado y el backend
 * sigue usando la configuración real de PostgreSQL en lugar de tumbar el arranque.
 */

// ¿Debe hablarse con el arnés en memoria?
// `USE_PG_MEM=false` es una salida explícita: permite que una suite E2E hable con el PostgreSQL
// real configurado en DATABASE_URL en lugar de quedar desviada al arnés. Es opt-in, así que sin
// esa variable el comportamiento es exactamente el de siempre.
const esProduccion = () =>
  process.env.NODE_ENV === 'production' || Boolean(process.env.RAILWAY_ENVIRONMENT);

const pideBaseReal = () => process.env.USE_PG_MEM === 'false';
const enModoMemoria = () => {
  if (esProduccion()) return false;
  return (
    !pideBaseReal() &&
    (process.env.NODE_ENV === 'test' || process.env.USE_PG_MEM === 'true' || process.env.JEST_WORKER_ID !== undefined)
  );
};

// Esquema del harness. Es permisivo a propósito (sin FK ni CHECK): el objetivo es que las suites de
// integración ejerciten el SQL y las queries reales, no re-validar las restricciones de las
// migraciones de producción (ver backend/src/db/migrations/012_business_engine.sql y 013_memberships.sql).
//
// ⚠️ REGLA QUE NO SE PUEDE ROMPER: se omiten FK y CHECK, pero NUNCA los TIPOS. Un tipo distinto aquí
// hace que el emulador mienta y produzca fallos que en producción NO existen. Caso real que costó
// 4 suites rojas: `business_documents.provider_id` estaba como VARCHAR(36) mientras la migración 012
// lo declara INTEGER; el servicio compara `doc.provider_id !== req.user.id` de forma estricta, así que
// en el emulador llegaba "101" (string) y daba 403 al dueño de su propio documento. Al añadir o tocar
// una columna, copia el tipo exacto de su migración en backend/migrations/.
// Nota: para `business_documents.signed_by` el tipo vigente es VARCHAR(150) por la migración
// 080 (que corrige el INTEGER de 012, porque el código guarda el NOMBRE del firmante).
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255),
    phone VARCHAR(20),
    foto_url TEXT,
    auth_provider VARCHAR(50) DEFAULT 'LOCAL',
    provider_id VARCHAR(255),
    rol VARCHAR(20),
    worker_type VARCHAR(50),
    onboarding_completo BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    habeas_data_accepted_at TIMESTAMP,
    habeas_data_ip VARCHAR(45),
    responsable_iva BOOLEAN NOT NULL DEFAULT true,
    tarifa_iva NUMERIC(5,4) NOT NULL DEFAULT 0.1900,
    rut_numero VARCHAR(20),
    rut_responsabilidad_codigo SMALLINT,
    responsable_iva_override BOOLEAN,
    responsabilidad_iva_fuente VARCHAR(10),
    responsabilidad_iva_actualizada_at TIMESTAMP,
    responsabilidad_iva_cambiada_por INTEGER
  );

  CREATE TABLE IF NOT EXISTS business_verticals (
    id VARCHAR(36) PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS business_profiles (
    id VARCHAR(36) PRIMARY KEY,
    -- provider_id INTEGER y tenant_id VARCHAR(64): tipos de la migracion 012
    -- (CREATE TABLE business_profiles), no VARCHAR(36). La 012 documenta la autoridad:
    -- businessController escribe req.user.id (usuarios.id es INTEGER) y
    -- ownerController.js:185 filtra provider_id = ANY($1::int[]). Con VARCHAR(36) el
    -- emulador miente: compara "5" !== 5 y da 403/404 donde produccion funciona. Misma
    -- clase que el caso business_documents documentado en la cabecera de este fichero.
    -- El id de negocio (business_profiles.id) SI sigue siendo VARCHAR(36) (nota 2 de la 012).
    provider_id INTEGER,
    tenant_id VARCHAR(64),
    vertical_id VARCHAR(36),
    user_id INTEGER,
    name VARCHAR(150) NOT NULL,
    onboarding_mode VARCHAR(30) DEFAULT 'NEW_BUSINESS',
    lifecycle_stage VARCHAR(30) DEFAULT 'IDEA',
    compliance_score NUMERIC(5,2) DEFAULT 0.00,
    city VARCHAR(100) DEFAULT 'Bogotá',
    country VARCHAR(100) DEFAULT 'Colombia',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS business_requirements (
    id VARCHAR(36) PRIMARY KEY,
    vertical_id VARCHAR(36),
    code VARCHAR(50) NOT NULL UNIQUE,
    title VARCHAR(150) NOT NULL,
    description TEXT,
    legal_basis TEXT,
    jurisdiction VARCHAR(50) DEFAULT 'NATIONAL',
    domain_context VARCHAR(30),
    evidence_required VARCHAR(50) DEFAULT 'DOCUMENT',
    frequency_months INTEGER DEFAULT 12,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS business_tasks (
    id VARCHAR(36) PRIMARY KEY,
    business_profile_id VARCHAR(36),
    requirement_id VARCHAR(36),
    tenant_id VARCHAR(36),
    title VARCHAR(150) NOT NULL,
    description TEXT,
    stage VARCHAR(20) DEFAULT 'ENTENDER',
    status VARCHAR(20) DEFAULT 'PENDING',
    due_date TIMESTAMP,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS business_evidences (
    id VARCHAR(36) PRIMARY KEY,
    task_id VARCHAR(36),
    file_path VARCHAR(255),
    evidence_type VARCHAR(30) DEFAULT 'DOCUMENT',
    validation_state VARCHAR(30) DEFAULT 'USER_DECLARED',
    reviewer_notes TEXT,
    verified_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS business_findings (
    id VARCHAR(36) PRIMARY KEY,
    business_profile_id VARCHAR(36),
    title VARCHAR(150) NOT NULL,
    description TEXT,
    risk_level VARCHAR(20) DEFAULT 'MEDIUM',
    status VARCHAR(20) DEFAULT 'OPEN',
    mitigation_plan TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS document_templates (
    id VARCHAR(36) PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    title VARCHAR(150) NOT NULL,
    category VARCHAR(50) NOT NULL,
    template_body TEXT NOT NULL,
    disclaimer TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS business_documents (
    id VARCHAR(36) PRIMARY KEY,
    template_code VARCHAR(50),
    business_profile_id VARCHAR(36),
    provider_id INTEGER,
    tenant_id VARCHAR(36),
    title VARCHAR(150),
    category VARCHAR(50),
    rendered_body TEXT,
    watermark VARCHAR(100),
    disclaimer TEXT,
    version INTEGER DEFAULT 1,
    status VARCHAR(30) DEFAULT 'DRAFT',
    signed_by VARCHAR(150),
    signature_hash VARCHAR(128),
    signed_at TIMESTAMP,
    supersedes_id VARCHAR(36),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS document_audit_logs (
    id VARCHAR(36) PRIMARY KEY,
    document_id VARCHAR(36),
    tenant_id VARCHAR(36),
    provider_id VARCHAR(64) DEFAULT 'system',
    actor_id VARCHAR(64),
    action VARCHAR(50),
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS memberships (
    id VARCHAR(36) PRIMARY KEY,
    user_id INTEGER NOT NULL,
    business_profile_id VARCHAR(36) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'MEMBER',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    invited_at TIMESTAMP,
    accepted_at TIMESTAMP,
    created_by_user_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS services (
    id VARCHAR(36) PRIMARY KEY,
    provider_id INTEGER,
    business_profile_id VARCHAR(36),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price NUMERIC(10,2) NOT NULL,
    duration_minutes INTEGER NOT NULL,
    category VARCHAR(50),
    is_active BOOLEAN DEFAULT true
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id INTEGER,
    provider_id INTEGER,
    service_id VARCHAR(36),
    business_profile_id VARCHAR(36),
    scheduled_at TIMESTAMP,
    fecha_hora TIMESTAMP,
    duracion_minutos INTEGER,
    valor_bruto NUMERIC(10,2),
    comision_plataforma NUMERIC(10,2),
    impuestos_estado NUMERIC(10,2),
    pago_neto_prestador NUMERIC(10,2),
    tarifa_reserva NUMERIC(10,2),
    subtotal_base NUMERIC(12,2),
    iva_valor NUMERIC(12,2),
    tarifa_iva_aplicada NUMERIC(5,4),
    service_address TEXT,
    notes TEXT,
    estado VARCHAR(50),
    productos_adicionales JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    cufe VARCHAR(96),
    qr_factura TEXT,
    factura_emitida BOOLEAN DEFAULT FALSE,
    factura_fecha TIMESTAMPTZ,
    -- D-GL-023/024 (migraciones 096-098): cancelación, reprogramación, propina
    cancelado_por VARCHAR(20),
    cancelado_at TIMESTAMP,
    completed_at TIMESTAMP,
    reschedule_count INTEGER DEFAULT 0,
    propina NUMERIC(10,2) DEFAULT 0,
    credito_aplicado NUMERIC(10,2) DEFAULT 0,
    checkin_lat NUMERIC(10,7),
    checkin_lng NUMERIC(10,7),
    service_lat NUMERIC(10,7),
    service_lng NUMERIC(10,7)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
    client_id INTEGER,
    provider_id INTEGER,
    amount NUMERIC(10,2),
    monto_total NUMERIC(10,2),
    comision_plataforma NUMERIC(10,2),
    monto_neto_prestador NUMERIC(10,2),
    impuestos_retencion NUMERIC(10,2),
    status VARCHAR(20),
    payment_method VARCHAR(50),
    external_id VARCHAR(255),
    pasarela_pago VARCHAR(50),
    referencia_pasarela VARCHAR(255),
    estado_pago VARCHAR(50),
    liberado_al_prestador BOOLEAN,
    created_en TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tenants (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    slug VARCHAR(100),
    es_plataforma BOOLEAN DEFAULT false
  );

  -- Columnas alineadas con las migraciones REALES (009_create_productos_table.sql,
  -- 010_implement_glowstore_schema.sql, 032): sin descripcion/imagen_url/tag_especialidad/
  -- tipo_visibilidad la consulta de productController reventaba, y ese 500 se confundia con
  -- un defecto del candado. Nullables a proposito: el emulador imita COLUMNAS, no
  -- constraints; un NOT NULL aqui solo romperia inserts de otras suites.
  CREATE TABLE IF NOT EXISTS productos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(255),
    sku VARCHAR(40),
    costo NUMERIC(10,2),
    stock INTEGER DEFAULT 0,
    tenant_id INTEGER,
    descripcion TEXT,
    imagen_url TEXT,
    tag_especialidad VARCHAR(50),
    tipo_visibilidad VARCHAR(50)
  );

  CREATE TABLE IF NOT EXISTS listas_precios (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(40) UNIQUE,
    nombre VARCHAR(120),
    rol_destino VARCHAR(20),
    incluye_iva BOOLEAN DEFAULT true,
    vigente_desde DATE DEFAULT CURRENT_DATE,
    vigente_hasta DATE,
    estado VARCHAR(20) DEFAULT 'ACTIVA',
    tenant_id INTEGER
  );

  CREATE TABLE IF NOT EXISTS precios_producto (
    lista_id INTEGER,
    producto_id INTEGER,
    precio NUMERIC(10,2),
    unidad_minima INTEGER DEFAULT 1,
    vigente_desde DATE DEFAULT CURRENT_DATE,
    vigente_hasta DATE,
    tenant_id INTEGER,
    PRIMARY KEY (lista_id, producto_id)
  );

  CREATE TABLE IF NOT EXISTS precios_historial (
    id SERIAL PRIMARY KEY,
    lista_id INTEGER,
    producto_id INTEGER,
    precio_anterior NUMERIC(10,2),
    precio_nuevo NUMERIC(10,2),
    actor_id INTEGER,
    origen VARCHAR(30),
    motivo TEXT,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    tenant_id INTEGER
  );

  CREATE TABLE IF NOT EXISTS beauty_profiles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE,
    face_scores JSONB,
    hands_diagnosis JSONB,
    recommendation TEXT,
    recommended_products JSONB,
    entry_point VARCHAR(50) DEFAULT 'ideas',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS biometric_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    profile_id VARCHAR(36),
    face_scores JSONB,
    hands_diagnosis JSONB,
    recommendation TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS glow_cycle_measurements (
    id SERIAL PRIMARY KEY,
    cycle_id VARCHAR(36),
    user_id INTEGER NOT NULL,
    measurement_type VARCHAR(30) NOT NULL,
    day_number INTEGER NOT NULL DEFAULT 1,
    encrypted_scores TEXT NOT NULL,
    score_delta JSONB DEFAULT '{}'::jsonb,
    ai_evaluation_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS pedidos_tienda (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comprador_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    rol_comprador VARCHAR(20) NOT NULL,
    booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
    prestador_comisionado_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    comision_total_prestador NUMERIC(10,2) DEFAULT 0.00 CHECK (comision_total_prestador >= 0),
    subtotal NUMERIC(10,2) NOT NULL CHECK (subtotal >= 0),
    envio NUMERIC(10,2) DEFAULT 0.00 CHECK (envio >= 0),
    iva NUMERIC(10,2) DEFAULT 0.00 CHECK (iva >= 0),
    total NUMERIC(10,2) NOT NULL CHECK (total >= 0),
    estado VARCHAR(20) DEFAULT 'PENDIENTE_PAGO' CHECK (estado IN ('PENDIENTE_PAGO', 'PAGADO', 'DESPACHADO', 'ENTREGADO', 'CANCELADO')),
    nombre_entrega VARCHAR(255) NOT NULL,
    direccion_entrega TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    creado_en TIMESTAMPTZ DEFAULT NOW(),
    cufe VARCHAR(96),
    qr_factura TEXT,
    factura_emitida BOOLEAN DEFAULT FALSE,
    factura_fecha TIMESTAMPTZ
  );

  CREATE INDEX IF NOT EXISTS idx_pedidos_tienda_comprador ON pedidos_tienda(comprador_id);
  CREATE INDEX IF NOT EXISTS idx_pedidos_tienda_booking ON pedidos_tienda(booking_id);
  CREATE INDEX IF NOT EXISTS idx_pedidos_tienda_comisionado ON pedidos_tienda(prestador_comisionado_id);
  CREATE TABLE IF NOT EXISTS reembolsos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID,
    client_id INTEGER,
    monto NUMERIC(12,2) NOT NULL DEFAULT 0,
    porcentaje_devolucion NUMERIC(5,2) NOT NULL DEFAULT 0,
    tramo VARCHAR(20),
    motivo TEXT,
    estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    referencia_pasarela VARCHAR(255),
    creado_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    procesado_at TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS provider_wallet (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id INTEGER NOT NULL UNIQUE,
    saldo_disponible NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    saldo_pendiente NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    saldo_en_disputa NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    total_ganado NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    total_retirado NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    modelo_retiro VARCHAR(20) NOT NULL DEFAULT 'DEMANDA',
    ultimo_retiro_at TIMESTAMP,
    proximo_retiro_auto TIMESTAMP,
    risk_score INTEGER NOT NULL DEFAULT 0,
    retiros_pausados BOOLEAN NOT NULL DEFAULT FALSE,
    tipo_cuenta VARCHAR(20),
    banco VARCHAR(100),
    numero_cuenta VARCHAR(30),
    tipo_cuenta_bancaria VARCHAR(20),
    cuenta_verificada BOOLEAN NOT NULL DEFAULT FALSE,
    titular_nombre TEXT,
    titular_documento_tipo TEXT,
    titular_documento_num TEXT,
    wompi_beneficiary_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS wallet_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id INTEGER NOT NULL,
    booking_id UUID,
    tipo VARCHAR(30) NOT NULL,
    monto NUMERIC(12,2) NOT NULL,
    saldo_resultante NUMERIC(12,2) NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'COMPLETADO',
    referencia_wompi VARCHAR(255),
    descripcion TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS retiros (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id INTEGER NOT NULL,
    wallet_id UUID NOT NULL,
    monto NUMERIC(12,2) NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    tipo_origen VARCHAR(20) NOT NULL DEFAULT 'DEMANDA',
    referencia_wompi VARCHAR(255),
    error_wompi TEXT,
    numero_cuenta VARCHAR(30),
    banco VARCHAR(100),
    solicitado_at TIMESTAMP NOT NULL DEFAULT NOW(),
    procesado_at TIMESTAMP,
    metadata JSONB DEFAULT '{}'::jsonb
  );

  CREATE TABLE IF NOT EXISTS wallet_ledger_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tx_id UUID NOT NULL,
    provider_id INTEGER NOT NULL,
    evento VARCHAR(40) NOT NULL,
    detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
`;

const lit = (value) => (value === null || value === undefined ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`);

/**
 * Datos de referencia (verticales, requisitos y plantillas) tomados del mismo seed que usa el
 * Business Engine, para que las suites de integración no dependan de filas pre-cargadas a mano.
 */
function seedReferenceData(pgMem) {
  try {
    const { verticals, requirements, documentTemplates } = require('../db/seed_business_data');

    const verticalRows = verticals
      .map((v) => `(${lit(v.id)}, ${lit(v.code)}, ${lit(v.name)}, ${lit(v.description)})`)
      .join(',\n');
    if (verticalRows) {
      pgMem.public.none(
        `INSERT INTO business_verticals (id, code, name, description) VALUES ${verticalRows}
         ON CONFLICT (id) DO NOTHING`
      );
    }

    const requirementRows = requirements
      .map((r) => `(${lit(r.id)}, ${lit(r.vertical_id)}, ${lit(r.code)}, ${lit(r.title)}, ${lit(r.description)}, ` +
        `${lit(r.legal_basis)}, ${lit(r.jurisdiction)}, ${lit(r.domain_context)}, ${lit(r.evidence_required)}, ` +
        `${r.frequency_months === undefined ? 'NULL' : Number(r.frequency_months)})`)
      .join(',\n');
    if (requirementRows) {
      pgMem.public.none(
        `INSERT INTO business_requirements
           (id, vertical_id, code, title, description, legal_basis, jurisdiction, domain_context, evidence_required, frequency_months)
         VALUES ${requirementRows}
         ON CONFLICT (id) DO NOTHING`
      );
    }

    const templateRows = documentTemplates
      .map((t) => `(${lit(t.id)}, ${lit(t.code)}, ${lit(t.title)}, ${lit(t.category)}, ${lit(t.template_body)}, ${lit(t.disclaimer)})`)
      .join(',\n');
    if (templateRows) {
      pgMem.public.none(
        `INSERT INTO document_templates (id, code, title, category, template_body, disclaimer)
         VALUES ${templateRows}
         ON CONFLICT (id) DO NOTHING`
      );
    }
  } catch (err) {
    console.error(`⚠️ [pgMemory] No se pudieron cargar los datos de referencia: ${err.message}`);
  }
}

let adapter = null;
let poolInstance = null;
let pgMemInstance = null;
let enabled = false;

function wrapClientWithTxBackup(client) {
  const origQuery = client.query;
  let txBackup = null;
  client.query = function (text, params, callback) {
    if (typeof text === 'string') {
      const q = text.trim().toUpperCase();
      if (q === 'BEGIN' || q.startsWith('BEGIN;')) {
        if (pgMemInstance) txBackup = pgMemInstance.backup();
      } else if (q === 'ROLLBACK' || q.startsWith('ROLLBACK;')) {
        if (txBackup) {
          txBackup.restore();
          txBackup = null;
        }
      } else if (q === 'COMMIT' || q.startsWith('COMMIT;')) {
        txBackup = null;
      }
    }
    return origQuery.call(client, text, params, callback);
  };
  return client;
}

function initMemoryIfNeeded() {
  const isMem = enModoMemoria();
  if (!enabled && isMem) {
    try {
      // eslint-disable-next-line global-require
      const { newDb } = require('pg-mem');
      pgMemInstance = newDb();
      
      // Registrar funciones nativas que usa el schema (gen_random_uuid para UUIDs)
      pgMemInstance.public.registerFunction({
        name: 'gen_random_uuid',
        returns: 'uuid',
        implementation: () => require('crypto').randomUUID(),
        impure: true
      });
      
      pgMemInstance.public.none(SCHEMA_SQL);
      seedReferenceData(pgMemInstance);
      adapter = pgMemInstance.adapters.createPg();
      poolInstance = new adapter.Pool();
      adapter.query = (text, params) => poolInstance.query(text, params);
      enabled = true;
    } catch (err) {
      console.error(
        `⚠️ [pgMemory] pg-mem no disponible (${err.message}). ` +
        'Se usará la configuración real de PostgreSQL en lugar del harness en memoria.'
      );
    }
  }
}

initMemoryIfNeeded();

module.exports = {
  get isMemoryMode() {
    return enModoMemoria();
  },
  get enabled() {
    initMemoryIfNeeded();
    return enabled;
  },
  get adapter() {
    initMemoryIfNeeded();
    return adapter;
  },
  get pool() {
    initMemoryIfNeeded();
    if (!poolInstance) return null;
    return {
      query: (text, params) => poolInstance.query(text, params),
      connect: async () => {
        const client = await poolInstance.connect();
        return wrapClientWithTxBackup(client);
      },
      on: (...args) => poolInstance.on(...args)
    };
  }
};

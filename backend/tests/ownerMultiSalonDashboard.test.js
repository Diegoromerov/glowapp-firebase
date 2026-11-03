const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'test_secret_key_2026_at_least_32_chars_long';
process.env.JWT_SECRET = JWT_SECRET;

// ── Detección de base de datos REAL ─────────────────────────────────────────────────────────
// En modo test el pool de la aplicación desvía toda consulta a pg-mem (src/config/db.js), de
// modo que ni provisionando un PostgreSQL real se llegaba a tocar la base real. Cuando el
// entorno declara las dos URLs (administrador + rol de aplicación) esta suite pide el motor
// real de forma explícita. Sin base declarada nada cambia: se usa el arnés en memoria.
const ADMIN_DB_URL = process.env.DATABASE_URL_ADMIN || process.env.TEST_DATABASE_URL;
const APP_DB_URL = process.env.DATABASE_URL;
const HAY_BD_REAL = Boolean(ADMIN_DB_URL && APP_DB_URL);
if (HAY_BD_REAL) process.env.USE_PG_MEM = 'false';

const { pool } = require('../src/config/db');
const ownerRoutes = require('../src/routes/ownerRoutes');
const ownerController = require('../src/controllers/ownerController');
const { getJwtSecret } = require('../src/config/jwt');

const app = express();
app.use(express.json());
app.use('/api/v1/owner', ownerRoutes);

describe('Fase 3: Multi-Sede OWNER Dashboard & Endpoints Integration Tests', () => {
  let originalQuery;

  beforeAll(() => {
    originalQuery = pool.query;
  });

  afterEach(() => {
    pool.query = originalQuery;
  });

  test('GET /api/v1/owner/salones debe retornar las sedes del propietario con total de colaboradores', async () => {
      const ownerToken = jwt.sign({ id: 10, role: 'SALON', email: 'owner@salonglow.com' }, JWT_SECRET);

      pool.query = jest.fn().mockImplementation((text, params) => {
        if (/SELECT rol, tenant_id FROM usuarios/i.test(text)) {
          return Promise.resolve({ rows: [{ rol: 'SALON', tenant_id: 1 }] });
        }
        if (/app_usuario_identidad/i.test(text)) {
          return Promise.resolve({ rows: [{ rol: 'SALON', tenant_id: 1 }] });
        }
        if (/SELECT DISTINCT s\.id[\s\S]*FROM salones s/i.test(text)) {
        return Promise.resolve({ rows: [{ id: 1 }, { id: 2 }] });
      }
      if (/SELECT s\.id, s\.nombre_salon[\s\S]*FROM salones s/i.test(text)) {
        return Promise.resolve({
          rows: [
            {
              id: 1,
              nombre_salon: 'Sede Norte',
              id_dueno: 10,
              total_colaboradores: '3',
            },
            {
              id: 2,
              nombre_salon: 'Sede Sur',
              id_dueno: 10,
              total_colaboradores: '2',
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get('/api/v1/owner/salones')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.salones).toHaveLength(2);
    expect(res.body.salones[0].total_colaboradores).toBe(3);
    expect(res.body.salones[1].nombre_salon).toBe('Sede Sur');
  });

  test('GET /api/v1/owner/salones debe rebotar 403 a usuarios que no poseen ninguna sede', async () => {
      const userToken = jwt.sign({ id: 99, role: 'CLIENTE', email: 'cliente@gmail.com' }, JWT_SECRET);

      pool.query = jest.fn().mockImplementation((text, params) => {
        if (/SELECT rol, tenant_id FROM usuarios/i.test(text)) {
          return Promise.resolve({ rows: [{ rol: 'CLIENTE', tenant_id: null }] });
        }
        if (/app_usuario_identidad/i.test(text)) {
          return Promise.resolve({ rows: [{ rol: 'CLIENTE', tenant_id: null }] });
        }
        if (/SELECT DISTINCT s\.id[\s\S]*FROM salones s/i.test(text)) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

    const res = await request(app)
      .get('/api/v1/owner/salones')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toContain('No tienes sedes registradas');
  });

  test('POST /api/v1/owner/switch-salon debe autorizar sedes propias y responder active_salon_id pasando por query, body o cabecera x-active-salon-id', async () => {
      const ownerToken = jwt.sign({ id: 10, role: 'SALON', email: 'owner@salonglow.com' }, JWT_SECRET);

      pool.query = jest.fn().mockImplementation((text, params) => {
        if (/SELECT rol, tenant_id FROM usuarios/i.test(text)) {
          return Promise.resolve({ rows: [{ rol: 'SALON', tenant_id: 1 }] });
        }
        if (/app_usuario_identidad/i.test(text)) {
          return Promise.resolve({ rows: [{ rol: 'SALON', tenant_id: 1 }] });
        }
        if (/AS sub_rol[\s\S]*FROM memberships/i.test(text)) {
          return Promise.resolve({ rows: [{ sub_rol: 'DUEÑO' }] });
        }
        return Promise.resolve({ rows: [] });
      });

    // Prueba 1: Vía body
    const resBody = await request(app)
      .post('/api/v1/owner/switch-salon')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ salon_id: 2 });

    expect(resBody.statusCode).toBe(200);
    expect(resBody.body.success).toBe(true);
    expect(resBody.body.active_salon_id).toBe(2);

    // Prueba 2: Vía cabecera x-active-salon-id
    const resHeader = await request(app)
      .post('/api/v1/owner/switch-salon')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-active-salon-id', '2');

    expect(resHeader.statusCode).toBe(200);
    expect(resHeader.body.active_salon_id).toBe(2);
  });

  test('GET /api/v1/owner/dashboard-metrics debe consultar columnas reales SQL, detectar prestadores cross-tenant y emitir advertencia', async () => {
      const ownerToken = jwt.sign({ id: 10, role: 'SALON', email: 'owner@salonglow.com' }, JWT_SECRET);
      let executedBookingsQuery = null;

      pool.query = jest.fn().mockImplementation((text, params) => {
        if (/SELECT rol, tenant_id FROM usuarios/i.test(text)) {
          return Promise.resolve({ rows: [{ rol: 'SALON', tenant_id: 1 }] });
        }
        if (/app_usuario_identidad/i.test(text)) {
          return Promise.resolve({ rows: [{ rol: 'SALON', tenant_id: 1 }] });
        }
        if (/SELECT DISTINCT s\.id[\s\S]*FROM salones s/i.test(text)) {
        return Promise.resolve({ rows: [{ id: 1 }, { id: 2 }] });
      }
      if (/JOIN usuarios u/i.test(text)) {
        return Promise.resolve({
          rows: [
            { provider_id: 50, salon_id: 1, nombre_prestador: 'Carlos Mendoza' },
            { provider_id: 50, salon_id: 2, nombre_prestador: 'Carlos Mendoza' },
            { provider_id: 60, salon_id: 2, nombre_prestador: 'Sofía López' },
          ],
        });
      }
      // E-02c: el identificador pasó de `sm.user_id` (salon_miembros) a
      // `m.user_id` (memberships); el prefijo ya no es fijo.
      if (/SELECT DISTINCT \w+\.user_id AS provider_id/i.test(text)) {
        return Promise.resolve({ rows: [{ provider_id: 50 }, { provider_id: 60 }] });
      }
      // Detección cross-tenant
      if (/NOT\s*\(\s*(sm\.salon_id|substring\(bp\.id from 7\)::int)\s*=\s*ANY/i.test(text)) {
        return Promise.resolve({
          rows: [{ provider_id: 50, salon_id: 99 }], // Prestador 50 tiene sede 99 en otro dueño
        });
      }
      if (/FROM bookings/i.test(text)) {
        executedBookingsQuery = text;
        return Promise.resolve({
          rows: [
            {
              id: 'b-101',
              provider_id: 50,
              valor_bruto: 100000,
              comision_plataforma: 20000,
              impuestos_estado: 8000,
              pago_neto_prestador: 72000,
              scheduled_at: '2026-09-20T10:00:00Z',
            },
            {
              id: 'b-102',
              provider_id: 60,
              valor_bruto: 50000,
              comision_plataforma: 10000,
              impuestos_estado: 4000,
              pago_neto_prestador: 36000,
              scheduled_at: '2026-09-21T14:00:00Z',
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get('/api/v1/owner/dashboard-metrics')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    expect(executedBookingsQuery).toBeDefined();
    expect(executedBookingsQuery).toContain('scheduled_at');
    expect(executedBookingsQuery).toContain('estado IN');

    const metrics = res.body.metrics;
    expect(metrics.ingresos_brutos).toBe(150000);
    expect(metrics.comision_plataforma).toBe(30000);
    expect(metrics.impuestos_estado).toBe(12000);
    expect(metrics.ingresos_netos_negocio).toBe(108000);
    expect(metrics.pago_neto_prestadores).toBe(108000);
    expect(metrics.total_citas).toBe(2);
    expect(metrics.sedes_compartidas).toBe(true);
    expect(metrics.prestadores_multinegocio).toBe(true);
    expect(metrics.prestadores_externos).toHaveLength(1);
    expect(metrics.advertencia).toContain('Los totales pueden incluir reservas de salones ajenos');
  });

  test('Test de Contrato de Esquema Estricto: aplica whitelist validBookingsColumns sobre el SELECT de bookings', async () => {
    const validBookingsColumns = [
      'id',
      'client_id',
      'provider_id',
      'service_id',
      'scheduled_at',
      'valor_bruto',
      'comision_plataforma',
      'impuestos_estado',
      'pago_neto_prestador',
      'estado',
      'pin_verificacion',
      'payment_status',
      'service_address',
      'tipo_via',
      'numero_via',
      'numero_placa',
      'numero_complemento',
      'complemento_interior',
      'barrio',
      'localidad',
      'notes',
      'created_at',
    ];

    let queryCaptured = '';
    pool.query = jest.fn().mockImplementation((text) => {
      if (/FROM memberships/i.test(text) && /DISTINCT/i.test(text)) {
        return Promise.resolve({ rows: [{ provider_id: 50 }] });
      }
      if (/FROM memberships/i.test(text) && /nombre_prestador/i.test(text)) {
        return Promise.resolve({
          rows: [{ provider_id: 50, salon_id: 1, nombre_prestador: 'Carlos Mendoza' }],
        });
      }
      if (/FROM bookings/i.test(text)) {
        queryCaptured = text;
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const req = {
      user: { id: 10 },
      ownedSalonIds: [1],
      query: { startDate: '2026-01-01', endDate: '2026-12-31' },
    };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await ownerController.getDashboardMetrics(req, res);

    expect(queryCaptured).toBeDefined();

    // 1. Guardas rápidas contra nombres de columnas erróneas legadas
    expect(queryCaptured).not.toContain('fecha');
    expect(queryCaptured).not.toContain('estado_cita');
    expect(queryCaptured).not.toContain('monto_proveedor');

    // 2. Extracción y verificación activa de la whitelist en la cláusula SELECT
    const selectMatch = queryCaptured.match(/SELECT\s+([\s\S]+?)\s+FROM\s+bookings/i);
    expect(selectMatch).not.toBeNull();

    const selectClause = selectMatch[1];
    const selectedColumns = selectClause
      .split(',')
      .map((col) => col.trim().split(/\s+/)[0])
      .filter(Boolean);

    expect(selectedColumns.length).toBeGreaterThan(0);
    const isSelectSubset = selectedColumns.every((col) => validBookingsColumns.includes(col));
    expect(isSelectSubset).toBe(true);

    // 3. Extracción dinámica y verificación activa de la whitelist en la cláusula WHERE (sin lista hardcodeada)
    const whereMatch = queryCaptured.match(/WHERE\s+([\s\S]+?)$/i);
    expect(whereMatch).not.toBeNull();
    const cleanWhereText = whereMatch[1]
      .replace(/'[^']*'/g, '')
      .replace(/::[a-z0-9_]+/gi, '');

    const sqlKeywords = new Set(['and', 'or', 'any', 'in', 'not', 'is', 'null', 'select', 'from', 'where']);
    const rawTokens = cleanWhereText.match(/\b([a-z_][a-z0-9_]*)\b/gi) || [];
    const extractedWhereCols = Array.from(
      new Set(
        rawTokens
          .map((t) => t.toLowerCase())
          .filter((t) => !sqlKeywords.has(t) && isNaN(Number(t)))
      )
    );

    expect(extractedWhereCols.length).toBeGreaterThan(0);
    const unknownWhereCols = extractedWhereCols.filter((col) => !validBookingsColumns.includes(col));
    expect(unknownWhereCols).toEqual([]);
  });
});

// ============================================================================================
// E2E REAL contra PostgreSQL — OWNER multi-sede (sin mocks de pool.query)
// ============================================================================================
// Hallazgo P0 t_fix_qa_02 «Backend sin E2E contra BD real»:
//   1. Todo el bloque de arriba sustituye pool.query por jest.fn() con filas fabricadas, así que
//      el SQL del controlador nunca se ejecuta contra un motor SQL real.
//   2. El único bloque "contra BD real" vivía tras `describe.skip` condicionado por
//      TEST_DATABASE_URL, variable que el paso de jest de CI (.github/workflows/ci.yml) no
//      define → no corría ni en local ni en CI.
//   3. Y aun con un PostgreSQL provisionado, el pool en modo test desviaba toda consulta al
//      arnés en memoria, por lo que la base real era inalcanzable desde la app bajo test.
// Esta suite reemplaza ese bloque: levanta la app Express real (authMiddleware + ownerGuard +
// controlador), firma JWT reales y ejecuta el SQL real contra un PostgreSQL REAL usando el
// mismo rol de aplicación que producción, con RLS activo. Solo se salta si no hay BD declarada.

const REAL_QUERY = pool.query; // referencia real capturada antes de que corran los mocks de arriba

// El guard abre una transacción real (runInTenantTransaction) y necesita
// `pool.connect`. Los bloques mockeados solo reemplazan `pool.query`, así que se
// les entrega un cliente que delega en el mock; contra la base real, el original.
const REAL_CONNECT = pool.connect.bind(pool);
pool.connect = async () => (pool.query === REAL_QUERY
  ? REAL_CONNECT()
  : { query: (text, params) => pool.query(text, params), release: () => {} });
const describeE2EReal = HAY_BD_REAL ? describe : describe.skip;

describeE2EReal('E2E REAL contra PostgreSQL: OWNER multi-sede (sin mocks de pool.query)', () => {
  const TENANT_A = 910001;
  const TENANT_B = 910002;
  const OWNER = 911010;
  const PRESTADOR_COMPARTIDO = 911050;
  const PRESTADOR_LOCAL = 911060;
  const PRESTADOR_INACTIVO = 911061;
  const PRESTADOR_AJENO = 911070;
  const OTRO_DUENO = 919999;
  const CLIENTE = 912000;
  const SEDE_NORTE = 910001;
  const SEDE_SUR = 910002;
  const SEDE_AJENA = 910099;
  const SERVICIO = 'aaaa0005-0000-4000-8000-000000000005';
  const BK_COMPARTIDO = 'aaaa0001-0000-4000-8000-000000000001';
  const BK_LOCAL = 'aaaa0002-0000-4000-8000-000000000002';
  const BK_PENDIENTE = 'aaaa0003-0000-4000-8000-000000000003';
  const BK_AJENO = 'aaaa0004-0000-4000-8000-000000000004';

  let adminPool;
  let ownerToken;
  let clienteToken;
  // Agregados esperados, derivados de las filas que la BD real produjo al sembrar (el trigger
  // calc_booking_split recalcula el reparto sobre valor_bruto, así que no se hardcodea).
  let esperado;

  const FIXTURE = () => ({
    usuarios: [OWNER, PRESTADOR_COMPARTIDO, PRESTADOR_LOCAL, PRESTADOR_INACTIVO, PRESTADOR_AJENO, OTRO_DUENO, CLIENTE],
    emails: [
      'owner.e2e@salonglow.com', 'shared.e2e@salonglow.com', 'local.e2e@salonglow.com',
      'inactivo.e2e@salonglow.com', 'ajeno.e2e@salonglow.com', 'otro.e2e@salonglow.com',
      'cliente.e2e@salonglow.com',
    ],
    salones: [SEDE_NORTE, SEDE_SUR, SEDE_AJENA],
    bookings: [BK_COMPARTIDO, BK_LOCAL, BK_PENDIENTE, BK_AJENO],
  });

  /** Ejecuta `fn` en una transacción y siempre deja la conexión en estado reutilizable. */
  const enTransaccion = async (fn) => {
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      await fn(client);
      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {
        /* la conexión ya está inutilizable; el pool la descartará */
      }
      throw err;
    } finally {
      client.release();
    }
  };

  /** Borra el fixture. Se repite por inquilino porque las políticas RLS acotan cada borrado. */
  const borrarFixture = async (client) => {
    const f = FIXTURE();
    for (const tenant of [TENANT_A, TENANT_B]) {
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [String(tenant)]);
      await client.query(
        `DELETE FROM bookings
          WHERE id = ANY($1::uuid[])
             OR provider_id = ANY($2::int[])
             OR client_id = ANY($2::int[])
             OR service_id = $3`,
        [f.bookings, f.usuarios, SERVICIO]
      );
      // E-02c: la identidad canónica no cuelga por FK de `salones`, así que hay
      // que limpiarla explícitamente o sobrevive entre corridas y contamina el
      // caso «usuario sin sedes».
      await client.query(`DELETE FROM memberships WHERE business_profile_id = ANY($1::text[])`,
        [f.salones.map((s) => `salon-${s}`)]);
      await client.query(`DELETE FROM business_profiles WHERE id = ANY($1::text[])`,
        [f.salones.map((s) => `salon-${s}`)]);
      await client.query(`DELETE FROM services WHERE id = $1`, [SERVICIO]);
      await client.query(`DELETE FROM salones WHERE id = ANY($1::int[])`, [f.salones]);
      await client.query(`DELETE FROM perfiles_prestador WHERE id = ANY($1::int[])`, [f.usuarios]);
      await client.query(
        `DELETE FROM usuarios WHERE id = ANY($1::int[]) OR email = ANY($2::varchar[])`,
        [f.usuarios, f.emails]
      );
    }
    await client.query(`DELETE FROM tenants WHERE id = ANY($1::int[])`, [[TENANT_A, TENANT_B]]);
  };

  /** Siembra real e idempotente: primero limpia, después inserta. */
  const ejecutarSeed = () => enTransaccion(async (client) => {
    await borrarFixture(client);

    await client.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, 'E2E Tenant A', 'e2e-a'), ($2, 'E2E Tenant B', 'e2e-b')`,
      [TENANT_A, TENANT_B]
    );

    // ── Inquilino A ─────────────────────────────────────────────────────────────
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [String(TENANT_A)]);
    await client.query(
      `INSERT INTO usuarios (id, email, nombre, auth_provider, provider_id, rol, tenant_id) VALUES
         ($1, 'owner.e2e@salonglow.com',    'Owner E2E',            'LOCAL', 'e2e:owner',    'PRESTADOR', $6),
         ($2, 'shared.e2e@salonglow.com',   'Prestador Compartido', 'LOCAL', 'e2e:shared',   'PRESTADOR', $6),
         ($3, 'local.e2e@salonglow.com',    'Prestador Local',      'LOCAL', 'e2e:local',    'PRESTADOR', $6),
         ($4, 'inactivo.e2e@salonglow.com', 'Prestador Inactivo',   'LOCAL', 'e2e:inactivo', 'PRESTADOR', $6),
         ($5, 'cliente.e2e@salonglow.com',  'Cliente E2E',          'LOCAL', 'e2e:cliente',  'CLIENTE',   $6)`,
      [OWNER, PRESTADOR_COMPARTIDO, PRESTADOR_LOCAL, PRESTADOR_INACTIVO, CLIENTE, TENANT_A]
    );
    await client.query(
      `INSERT INTO perfiles_prestador (id, business_name, tenant_id)
         SELECT u.id, u.nombre, u.tenant_id FROM usuarios u
          WHERE u.id = ANY($1::int[])
            AND NOT EXISTS (SELECT 1 FROM perfiles_prestador p WHERE p.id = u.id)`,
      [[OWNER, PRESTADOR_COMPARTIDO, PRESTADOR_LOCAL, PRESTADOR_INACTIVO]]
    );
    await client.query(
      `INSERT INTO services (id, provider_id, name, price, duration_minutes, tenant_id)
         VALUES ($1, $2, 'Servicio E2E', 100000, 60, $3)`,
      [SERVICIO, PRESTADOR_COMPARTIDO, TENANT_A]
    );
    await client.query(
      `INSERT INTO salones (id, nombre_salon, id_dueno, ciudad, plan_saas, tenant_id) VALUES
         ($1, 'Sede Norte E2E', $3, 'Bogota',   'PRO', $4),
         ($2, 'Sede Sur E2E',   $3, 'Medellin', 'PRO', $4)`,
      [SEDE_NORTE, SEDE_SUR, OWNER, TENANT_A]
    );
    // T-127: la pertenencia se siembra directamente en `memberships`; la tabla
    // heredada `salon_miembros` ya no existe (migración 118).
    // E-02c: el arnés no trae verticales y `business_profiles.vertical_id` es NOT
    // NULL; se siembra el vertical de belleza una sola vez.
    await client.query(
      `INSERT INTO business_verticals (id, code, name) VALUES ('e02c-belleza', 'BELLEZA', 'Belleza')
       ON CONFLICT (code) DO NOTHING`
    );
    // E-02c: el guard resuelve la sede en `memberships`; el fixture materializa
    // la identidad canónica con el tenant REAL (el 'tenant-<id>' del backfill no
    // lo vería la política de business_profiles).
    await client.query(
      `INSERT INTO business_profiles (id, provider_id, vertical_id, name, tenant_id)
       SELECT 'salon-' || s.id, s.id_dueno,
              (SELECT id FROM business_verticals ORDER BY name LIMIT 1),
              s.nombre_salon, s.tenant_id::text
         FROM salones s WHERE s.id IN ($1, $2)
       ON CONFLICT (id) DO NOTHING`,
      [SEDE_NORTE, SEDE_SUR]
    );
    await client.query(
      `INSERT INTO memberships (id, user_id, business_profile_id, role, sub_rol, status, accepted_at) VALUES
         (md5('e2e-a1'), $3, 'salon-' || $1::text, 'OWNER',  'DUEÑO',                   'ACTIVE',    CURRENT_TIMESTAMP),
         (md5('e2e-a2'), $3, 'salon-' || $2::text, 'OWNER',  'DUEÑO',                   'ACTIVE',    CURRENT_TIMESTAMP),
         (md5('e2e-a3'), $4, 'salon-' || $1::text, 'MEMBER', 'PRESTADOR_INDEPENDIENTE', 'ACTIVE',    CURRENT_TIMESTAMP),
         (md5('e2e-a4'), $4, 'salon-' || $2::text, 'MEMBER', 'PRESTADOR_INDEPENDIENTE', 'ACTIVE',    CURRENT_TIMESTAMP),
         (md5('e2e-a5'), $5, 'salon-' || $1::text, 'MEMBER', 'PRESTADOR_INDEPENDIENTE', 'ACTIVE',    CURRENT_TIMESTAMP),
         (md5('e2e-a6'), $6, 'salon-' || $1::text, 'MEMBER', 'PRESTADOR_INDEPENDIENTE', 'SUSPENDED', CURRENT_TIMESTAMP)
       ON CONFLICT (user_id, business_profile_id) DO UPDATE SET
         role = EXCLUDED.role, sub_rol = EXCLUDED.sub_rol, status = EXCLUDED.status`,
      [SEDE_NORTE, SEDE_SUR, OWNER, PRESTADOR_COMPARTIDO, PRESTADOR_LOCAL, PRESTADOR_INACTIVO]
    );
    await client.query(
      `INSERT INTO bookings (id, client_id, provider_id, service_id, scheduled_at, valor_bruto,
                             comision_plataforma, impuestos_estado, pago_neto_prestador, estado, tenant_id) VALUES
         ($1, $4, $5, $7, '2026-09-20 10:00:00+00', 100000, 20000, 8000, 72000, 'COMPLETADA', $8),
         ($2, $4, $6, $7, '2026-09-21 14:00:00+00',  50000, 10000, 4000, 36000, 'COMPLETADA', $8),
         ($3, $4, $5, $7, '2026-09-22 10:00:00+00', 999999,     0,    0,     0, 'PENDIENTE_PAGO', $8)`,
      [BK_COMPARTIDO, BK_LOCAL, BK_PENDIENTE, CLIENTE, PRESTADOR_COMPARTIDO, PRESTADOR_LOCAL, SERVICIO, TENANT_A]
    );

    // ── Inquilino B: datos que NO deben filtrarse al inquilino A ────────────────
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [String(TENANT_B)]);
    await client.query(
      `INSERT INTO usuarios (id, email, nombre, auth_provider, provider_id, rol, tenant_id) VALUES
         ($1, 'ajeno.e2e@salonglow.com', 'Prestador Ajeno', 'LOCAL', 'e2e:ajeno', 'PRESTADOR', $3),
         ($2, 'otro.e2e@salonglow.com',  'Otro Dueno',      'LOCAL', 'e2e:otro',  'PRESTADOR', $3)`,
      [PRESTADOR_AJENO, OTRO_DUENO, TENANT_B]
    );
    await client.query(
      `INSERT INTO perfiles_prestador (id, business_name, tenant_id)
         SELECT u.id, u.nombre, u.tenant_id FROM usuarios u
          WHERE u.id = ANY($1::int[])
            AND NOT EXISTS (SELECT 1 FROM perfiles_prestador p WHERE p.id = u.id)`,
      [[PRESTADOR_AJENO]]
    );
    await client.query(
      `INSERT INTO salones (id, nombre_salon, id_dueno, ciudad, plan_saas, tenant_id)
         VALUES ($1, 'Sede Ajena E2E', $2, 'Cali', 'PRO', $3)`,
      [SEDE_AJENA, OTRO_DUENO, TENANT_B]
    );
    // E-02c: identidad canónica para el tenant ajeno del fixture.
    await client.query(
      `INSERT INTO business_profiles (id, provider_id, vertical_id, name, tenant_id)
       SELECT 'salon-' || s.id, s.id_dueno,
              (SELECT id FROM business_verticals ORDER BY name LIMIT 1),
              s.nombre_salon, s.tenant_id::text
         FROM salones s WHERE s.id = $1
       ON CONFLICT (id) DO NOTHING`,
      [SEDE_AJENA]
    );
    await client.query(
      `INSERT INTO memberships (id, user_id, business_profile_id, role, sub_rol, status, accepted_at) VALUES
         (md5('e2e-b1'), $2, 'salon-' || $1::text, 'MEMBER', 'PRESTADOR_INDEPENDIENTE', 'ACTIVE', CURRENT_TIMESTAMP),
         (md5('e2e-b2'), $3, 'salon-' || $1::text, 'MEMBER', 'PRESTADOR_INDEPENDIENTE', 'ACTIVE', CURRENT_TIMESTAMP)
       ON CONFLICT (user_id, business_profile_id) DO UPDATE SET
         role = EXCLUDED.role, sub_rol = EXCLUDED.sub_rol, status = EXCLUDED.status`,
      [SEDE_AJENA, PRESTADOR_AJENO, PRESTADOR_COMPARTIDO]
    );
    await client.query(
      `INSERT INTO bookings (id, client_id, provider_id, service_id, scheduled_at, valor_bruto,
                             comision_plataforma, impuestos_estado, pago_neto_prestador, estado, tenant_id)
         VALUES ($1, $2, $3, $4, '2026-09-23 10:00:00+00', 888888, 0, 0, 0, 'COMPLETADA', $5)`,
      [BK_AJENO, CLIENTE, PRESTADOR_AJENO, SERVICIO, TENANT_B]
    );
  });

  const limpiarSeed = () => enTransaccion(async (client) => { await borrarFixture(client); });

  beforeAll(async () => {
    // Los mocks del bloque de arriba restauran la referencia real en su afterEach; se reafirma.
    pool.query = REAL_QUERY;

    const { Pool } = require('pg');
    adminPool = new Pool({ connectionString: ADMIN_DB_URL, connectionTimeoutMillis: 5000, max: 2 });
    await ejecutarSeed();

    const sembradas = await adminPool.query(
      `SELECT valor_bruto, comision_plataforma, impuestos_estado, pago_neto_prestador
         FROM bookings WHERE id = ANY($1::uuid[])`,
      [[BK_COMPARTIDO, BK_LOCAL]]
    );
    const suma = (columna) => sembradas.rows.reduce((acc, fila) => acc + Number(fila[columna] || 0), 0);
    esperado = {
      ingresos_brutos: suma('valor_bruto'),
      comision_plataforma: suma('comision_plataforma'),
      impuestos_estado: suma('impuestos_estado'),
      pago_neto_prestadores: suma('pago_neto_prestador'),
    };
    esperado.ingresos_netos_negocio =
      esperado.ingresos_brutos - esperado.comision_plataforma - esperado.impuestos_estado;

    ownerToken = jwt.sign({ id: OWNER, role: 'SALON', email: 'owner.e2e@salonglow.com' }, getJwtSecret());
    clienteToken = jwt.sign({ id: CLIENTE, role: 'CLIENTE', email: 'cliente.e2e@salonglow.com' }, getJwtSecret());
  });

  afterAll(async () => {
    if (adminPool) {
      await limpiarSeed();
      await adminPool.end();
    }
    pool.query = REAL_QUERY;
    delete process.env.USE_PG_MEM; // que el resto de suites del worker vuelvan al arnés en memoria
  });

  test('la app bajo prueba consulta un PostgreSQL real, no el motor en memoria', async () => {
    // `current_database()` no existe en pg-mem: si el pool desvía al arnés, esta consulta falla.
    const res = await pool.query('SELECT current_database() AS db');
    expect(typeof res.rows[0].db).toBe('string');
    expect(res.rows[0].db.length).toBeGreaterThan(0);
    expect(jest.isMockFunction(pool.query)).toBe(false);

    // Y el catálogo real describe `salones` con sus columnas de producción.
    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'salones'`
    );
    const nombres = cols.rows.map((r) => r.column_name);
    for (const esperada of ['id', 'nombre_salon', 'id_dueno', 'plan_saas', 'location_public', 'tenant_id']) {
      expect(nombres).toContain(esperada);
    }
  });

  test('GET /api/v1/owner/salones devuelve las sedes reales con total_colaboradores calculado por SQL', async () => {
    const res = await request(app)
      .get('/api/v1/owner/salones')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const ids = res.body.salones.map((s) => s.id);
    expect(ids).toEqual([SEDE_NORTE, SEDE_SUR]);
    // El aislamiento multi-tenant (RLS) impide que la sede de otro dueño aparezca.
    expect(ids).not.toContain(SEDE_AJENA);

    const porId = Object.fromEntries(res.body.salones.map((s) => [s.id, s]));
    expect(porId[SEDE_NORTE].nombre_salon).toBe('Sede Norte E2E');
    // ACTIVOS: dueño + compartido + local = 3; el miembro INACTIVO no cuenta (FILTER real).
    expect(porId[SEDE_NORTE].total_colaboradores).toBe(3);
    expect(porId[SEDE_SUR].total_colaboradores).toBe(2);
  });

  test('GET /api/v1/owner/dashboard-metrics agrega sobre filas reales de bookings', async () => {
    const res = await request(app)
      .get('/api/v1/owner/dashboard-metrics')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.statusCode).toBe(200);
    const m = res.body.metrics;

    // Solo entran las dos citas COMPLETADA del inquilino A (100000 + 50000): el
    // PENDIENTE_PAGO queda fuera por el filtro de estado y la cita del otro inquilino por RLS.
    expect(m.ingresos_brutos).toBe(150000);
    expect(m.total_citas).toBe(2);

    // El resto de la agregación se contrasta contra lo que la base real guardó en esas filas
    // (el trigger calc_booking_split recalcula comisión/impuestos/neto al insertar).
    expect(m.comision_plataforma).toBe(esperado.comision_plataforma);
    expect(m.impuestos_estado).toBe(esperado.impuestos_estado);
    expect(m.pago_neto_prestadores).toBe(esperado.pago_neto_prestadores);
    expect(m.ingresos_netos_negocio).toBe(esperado.ingresos_netos_negocio);
    expect(m.ingresos_netos_negocio).toBe(m.ingresos_brutos - m.comision_plataforma - m.impuestos_estado);
    expect(m.sedes_compartidas).toBe(true);

    // Bajo RLS las membresías de OTRO inquilino son invisibles, así que el detector
    // cross-tenant no encuentra filas.
    //
    // La premisa original era correcta, pero no se cumplía: la petición no abría
    // transacción con su inquilino y RLS no tenía contexto (de ahí el 403 y el
    // `true` que se veía aquí). Con `tenantContext` montado en ownerRoutes la
    // aislamiento sí aplica y esta aserción vuelve a ser la verdadera.
    expect(m.prestadores_cross_tenant).toBe(false);
    expect(m.prestadores_externos).toEqual([]);
    expect(m.advertencia).toBeUndefined();
  });

  test('POST /api/v1/owner/switch-salon autoriza contra memberships reales y rechaza sedes ajenas', async () => {
    const propio = await request(app)
      .post('/api/v1/owner/switch-salon')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-active-salon-id', String(SEDE_SUR));
    expect(propio.statusCode).toBe(200);
    expect(propio.body.active_salon_id).toBe(SEDE_SUR);
    expect(propio.body.sub_rol).toBe('DUEÑO');

    const ajeno = await request(app)
      .post('/api/v1/owner/switch-salon')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-active-salon-id', String(SEDE_AJENA));
    expect(ajeno.statusCode).toBe(403);
    expect(ajeno.body.error).toContain('No perteneces a este salón');
  });

  test('GET /api/v1/owner/salones responde 403 real a un usuario sin sedes', async () => {
    const res = await request(app)
      .get('/api/v1/owner/salones')
      .set('Authorization', `Bearer ${clienteToken}`);

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toContain('No tienes sedes registradas como propietario');
  });
});
